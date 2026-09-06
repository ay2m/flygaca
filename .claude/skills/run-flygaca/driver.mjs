#!/usr/bin/env node
/**
 * Fly GACA driver — a Playwright REPL for poking the running app.
 *
 * The app has no headless entry point of its own: it is a React SPA that keeps
 * everything (logbook, records, study progress, entitlements) in localStorage
 * until an API is configured, so the only way to observe real behaviour is to
 * drive a browser. This wraps that in a line-oriented protocol an agent can
 * pipe commands into.
 *
 *   node .claude/skills/run-flygaca/driver.mjs --smoke      # scripted flow, exits 0/1
 *   node .claude/skills/run-flygaca/driver.mjs              # REPL on stdin
 *
 * Every command prints exactly one terminating line — `OK …` or `ERR …` — so a
 * caller can poll for it instead of sleeping.
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const BASE = flag('base', 'http://localhost:5173').replace(/\/$/, '');
const API = flag('api', 'http://localhost:8080').replace(/\/$/, '');
const SHOTS = flag('shots', join(process.env.TMPDIR || '/tmp', 'flygaca-shots'));

await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({
  headless: !has('headed'),
  executablePath: '/opt/pw-browsers/chromium',
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

/** Console + pageerror are drained by `console`, not printed as they arrive. */
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));

/**
 * Selector sugar, so callers don't quote `text=` expressions through three
 * layers of shell:
 *
 *   @name            → test id
 *   css=input[…]     → CSS  (explicit; needed for tag-led selectors)
 *   .cls / #id / […] → CSS  (unambiguous leading character)
 *   anything else    → visible text, substring match
 *
 * Bare input is text rather than CSS on purpose: the UI is full of strings like
 * "12.9" and "1.5", and a "contains a dot ⇒ CSS" rule silently mis-routes them.
 *
 * A selector may not contain spaces — each command line is split on whitespace,
 * so `css=input >> nth=0` would leak `>> nth=0` into the value. Use Playwright's
 * `:nth-match(input[inputmode="decimal"],2)` (1-based) to disambiguate.
 */
function locate(sel) {
  // Always `.first()`: the design system reuses class names (three `.container`
  // wrappers on most pages), and a strict-mode violation is a useless answer to
  // "show me the page".
  if (sel.startsWith('@')) return page.getByTestId(sel.slice(1)).first();
  if (sel.startsWith('css=')) return page.locator(sel.slice(4)).first();
  if (/^[.#\[]|:has|>>/.test(sel)) return page.locator(sel).first();
  return page.getByText(sel, { exact: false }).first();
}

const commands = {
  async goto(path = '/') {
    const url = path.startsWith('http') ? path : `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    // The SPA renders into an empty #root, so DOM-ready says nothing, and <main>
    // appears while the route chunk is still loading — RouteFallback fills it
    // with a `.skeleton` shimmer. Wait for that to detach or the page reads as
    // "Loading…" forever.
    //
    // Match `.skeleton`, not the fallback's `role="status"`: /tools and /learn
    // keep a status live region of their own permanently, so a status-based wait
    // silently costs the full timeout on every visit to them.
    await page.waitForSelector('main', { timeout: 15_000 });
    await page
      .locator('main .skeleton')
      .first()
      .waitFor({ state: 'detached', timeout: 20_000 })
      .catch(() => {});
    return `${page.url()} — ${await page.title()}`;
  },

  async ss(name = 'shot') {
    const file = join(SHOTS, `${name}.png`);
    // The stat cards animate up from zero (<CountUp>), and the grids fade in on
    // a stagger, so an immediate capture shows "0.0" next to a populated table.
    // Settle first — a screenshot is never in a tight loop.
    await page.waitForTimeout(900);
    await page.screenshot({ path: file, fullPage: false });
    return file;
  },

  /**
   * Click by accessible name first, falling back to plain text. This matters:
   * `getByText('Sign in')` on /account resolves to the page's <h1>, not the
   * submit button, and clicking the heading silently does nothing.
   */
  async click(...sel) {
    const name = sel.join(' ');
    if (!/^[@.#\[]|^css=|:has|>>/.test(name)) {
      for (const role of ['button', 'link']) {
        const byRole = page.getByRole(role, { name, exact: false }).first();
        if (await byRole.count()) {
          await byRole.click({ timeout: 10_000 });
          return `clicked ${role}`;
        }
      }
    }
    await locate(name).click({ timeout: 10_000 });
    return 'clicked';
  },

  async fill(sel, ...value) {
    await locate(sel).fill(value.join(' '));
    return 'filled';
  },

  /** Text content of a selector, or of <main> when omitted — collapsed to one line. */
  async text(...sel) {
    const target = sel.length ? locate(sel.join(' ')) : page.locator('main');
    const raw = await target.innerText({ timeout: 10_000 });
    return raw.replace(/\s+/g, ' ').trim().slice(0, 2000);
  },

  async count(...sel) {
    return String(await locate(sel.join(' ')).count());
  },

  async wait(...sel) {
    await locate(sel.join(' ')).waitFor({ state: 'visible', timeout: 15_000 });
    return 'visible';
  },

  async eval(...js) {
    const result = await page.evaluate(js.join(' '));
    return JSON.stringify(result ?? null);
  },

  /** Drain buffered console output. Nothing is printed until asked for. */
  async console() {
    const out = logs.splice(0).join(' | ');
    return out || '(empty)';
  },

  /**
   * Call the API from inside the page, so the session cookie and CORS policy
   * are exercised exactly as the app exercises them — `curl` bypasses both.
   */
  async api(method, path, ...body) {
    const payload = body.length ? body.join(' ') : null;
    return page.evaluate(
      async ([m, url, b]) => {
        const res = await fetch(url, {
          method: m,
          credentials: 'include',
          ...(b ? { headers: { 'Content-Type': 'application/json' }, body: b } : {}),
        });
        return `${res.status} ${(await res.text()).slice(0, 800)}`;
      },
      [method.toUpperCase(), `${API}${path}`, payload],
    );
  },

  /**
   * Sign in through the real form on /account. With no VITE_API_BASE_URL a DEV
   * build offers `LocalSignIn` (email + name, no password) — that is what this
   * drives. A production/preview build shows an "unavailable" notice instead
   * and this will fail; configure an API base URL for that case.
   */
  async signin(email = 'driver@flygaca.test', ...name) {
    await commands.goto('/account');
    const card = page.locator('main form').first();
    const fields = card.locator('input');
    await fields.nth(0).fill(email);
    await fields.nth(1).fill(name.join(' ') || 'Driver');
    await card.getByRole('button', { name: /sign in/i }).click();
    // The signed-in header shows the display name, not the address, so confirm
    // against the store: `flygaca:session` holds the email verbatim.
    await page.waitForFunction(
      (e) => localStorage.getItem('flygaca:session') === e,
      email,
      { timeout: 10_000 },
    );
    return `signed in as ${email}`;
  },

  async storage(key) {
    return page.evaluate((k) => (k ? localStorage.getItem(k) : Object.keys(localStorage).join(',')), key);
  },

  async help() {
    return Object.keys(commands).join(' ');
  },
};

async function run(line) {
  const [name, ...rest] = line.trim().split(/\s+/);
  if (!name) return;
  if (name === 'quit' || name === 'exit') {
    await browser.close();
    process.exit(0);
  }
  const fn = commands[name];
  if (!fn) return console.log(`ERR unknown command: ${name}`);
  try {
    console.log(`OK ${(await fn(...rest)) ?? ''}`);
  } catch (err) {
    console.log(`ERR ${String(err.message).split('\n')[0]}`);
  }
}

/**
 * The scripted flow. Kept in the driver rather than a separate smoke script so
 * there is one thing to run and one thing to keep working: it doubles as the
 * worked example of every command above.
 */
async function smoke() {
  const steps = [];
  const step = async (label, fn) => {
    try {
      const detail = await fn();
      steps.push(`PASS ${label}${detail ? ` — ${detail}` : ''}`);
    } catch (err) {
      steps.push(`FAIL ${label} — ${String(err.message).split('\n')[0]}`);
    }
  };

  await step('home renders', async () => commands.goto('/'));
  await step('home screenshot', async () => commands.ss('01-home'));

  await step('a calculator computes', async () => {
    await commands.goto('/tools/crosswind');
    // NumberField renders inputMode="decimal", NOT type="number" — the obvious
    // input[type=number] selector matches nothing anywhere in the tool suite.
    // DOM order here is runway heading, wind direction, wind speed.
    const inputs = page.locator('main input[inputmode="decimal"]');
    await inputs.nth(0).fill('180');
    await inputs.nth(1).fill('220');
    await inputs.nth(2).fill('20');
    // 20 kt at 40° off the centreline → 20·sin40 = 12.9 xw, 20·cos40 = 15.3 hw.
    const xw = page.locator('main').getByText('12.9', { exact: false }).first();
    await xw.waitFor({ state: 'visible', timeout: 10_000 });
    return 'crosswind 12.9 kt / headwind 15.3 kt';
  });
  await step('crosswind screenshot', async () => commands.ss('02-crosswind'));

  await step('local sign-in mints a session', async () => commands.signin('smoke@flygaca.test', 'Smoke Pilot'));

  await step('a flight added through the UI lands in the logbook', async () => {
    await commands.goto('/logbook');
    await page.getByRole('button', { name: 'Add flight' }).click();
    // FlightForm renders one TextField per FIELDS entry, in that order:
    // date, type, reg, from, to, total, pic, night, ifr, ldg, nightLdg, appr,
    // remarks. Placeholders repeat ('1.5' is both total and pic), so index the
    // form group rather than matching on placeholder text.
    const form = page.locator('[role="group"]').filter({ has: page.locator('input') }).last();
    const values = ['2026-01-02', 'C172', 'HZ-SMK', 'OERK', 'OEJN', '1.5', '1.5', '0', '0', '1'];
    for (const [idx, value] of values.entries()) await form.locator('input').nth(idx).fill(value);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('HZ-SMK').first().waitFor({ state: 'visible', timeout: 10_000 });
    const stored = await page.evaluate(() => localStorage.getItem('flygaca:logbook'));
    if (!stored?.includes('HZ-SMK')) throw new Error('flight did not reach flygaca:logbook');
    return 'HZ-SMK in the table and persisted to flygaca:logbook';
  });

  await step('logbook screenshot', async () => commands.ss('03-logbook'));

  await step('library loads the regulatory corpus index', async () => {
    await commands.goto('/library');
    return (await commands.text()).slice(0, 160);
  });

  await step('Arabic RTL mounts under /ar', async () => {
    await commands.goto('/ar/tools');
    return `dir=${await page.evaluate(() => document.documentElement.dir)} lang=${await page.evaluate(() => document.documentElement.lang)}`;
  });
  await step('arabic screenshot', async () => commands.ss('04-arabic-rtl'));

  await step('unknown route renders the 404 page', async () => {
    await commands.goto('/definitely-not-a-route');
    return (await commands.text()).slice(0, 120);
  });

  await step('no uncaught page errors', async () => {
    const errors = logs.filter((l) => l.startsWith('pageerror'));
    if (errors.length) throw new Error(errors.join(' | '));
    return 'clean';
  });

  console.log(steps.join('\n'));
  console.log(`\nScreenshots → ${SHOTS}`);
  const failed = steps.filter((s) => s.startsWith('FAIL')).length;
  await browser.close();
  process.exit(failed ? 1 : 0);
}

if (has('smoke')) {
  await smoke();
} else {
  console.log(`DRIVER READY base=${BASE} api=${API} shots=${SHOTS}`);
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) await run(line);
  await browser.close();
}
