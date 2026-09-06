import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The I/O half of the remote-brain client, and the seam that chooses it.
 *
 * `remote-brain-core.test.ts` covers the pure wire mapping. This covers what
 * only the network wrapper exercises — env parsing, the trusted-tier header,
 * what a non-200 does — plus `brain.ts` picking an implementation.
 *
 * The module is dormant by design (`ADEL_REMOTE_BASE_URL` is set on no
 * revision), which is exactly why it needs a spec: the first time anyone turns
 * the seam on, it should already have been exercised.
 */

const ENV = { ...process.env };

/** Import fresh so each case reads the env it just set. */
async function loadRemote() {
  vi.resetModules();
  return import("../src/remote-brain.js");
}

async function loadBrain() {
  vi.resetModules();
  return import("../src/brain.js");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A minimal well-formed `/v1/chat` body. */
const REMOTE_OK = {
  answer: "Under GACAR 61.107 you need 40 hours.",
  sources: [{ citation: "GACAR 61.107", url: "https://example.test/61.107" }],
  kind: "grounded",
};

beforeEach(() => {
  delete process.env.ADEL_REMOTE_BASE_URL;
  delete process.env.ADEL_REMOTE_TIMEOUT_MS;
  delete process.env.ADEL_API_KEY;
});

afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("remoteBrainConfig", () => {
  it("is null when ADEL_REMOTE_BASE_URL is unset — the state on every revision", async () => {
    const { remoteBrainConfig } = await loadRemote();
    expect(remoteBrainConfig()).toBeNull();
  });

  it("is null when the base URL is whitespace only", async () => {
    process.env.ADEL_REMOTE_BASE_URL = "   ";
    const { remoteBrainConfig } = await loadRemote();
    expect(remoteBrainConfig()).toBeNull();
  });

  it("strips trailing slashes so the /v1/chat join cannot double up", async () => {
    process.env.ADEL_REMOTE_BASE_URL = "https://adel.example///";
    const { remoteBrainConfig } = await loadRemote();
    expect(remoteBrainConfig()?.baseUrl).toBe("https://adel.example");
  });

  it("defaults the timeout to 60s when unset, non-numeric or not positive", async () => {
    process.env.ADEL_REMOTE_BASE_URL = "https://adel.example";
    const { remoteBrainConfig } = await loadRemote();
    expect(remoteBrainConfig()?.timeoutMs).toBe(60_000);

    for (const bad of ["not-a-number", "0", "-1"]) {
      process.env.ADEL_REMOTE_TIMEOUT_MS = bad;
      const fresh = await loadRemote();
      expect(fresh.remoteBrainConfig()?.timeoutMs).toBe(60_000);
    }
  });

  it("honours a positive numeric timeout", async () => {
    process.env.ADEL_REMOTE_BASE_URL = "https://adel.example";
    process.env.ADEL_REMOTE_TIMEOUT_MS = "1500";
    const { remoteBrainConfig } = await loadRemote();
    expect(remoteBrainConfig()?.timeoutMs).toBe(1500);
  });

  it("trims the api key and tolerates it being absent", async () => {
    process.env.ADEL_REMOTE_BASE_URL = "https://adel.example";
    const { remoteBrainConfig } = await loadRemote();
    expect(remoteBrainConfig()?.apiKey).toBe("");

    process.env.ADEL_API_KEY = "  secret  ";
    const fresh = await loadRemote();
    expect(fresh.remoteBrainConfig()?.apiKey).toBe("secret");
  });
});

describe("askRemote", () => {
  const cfg = { baseUrl: "https://adel.example", apiKey: "k", timeoutMs: 5_000 };

  it("posts to /v1/chat and maps the response through toCaptainAdelOutput", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(REMOTE_OK));
    vi.stubGlobal("fetch", fetchMock);

    const { askRemote } = await loadRemote();
    const out = await askRemote({ message: "how many hours?" }, cfg);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://adel.example/v1/chat");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      message: "how many hours?",
      history: [],
      product: "flygaca",
    });

    expect(out.answer).toBe(REMOTE_OK.answer);
    expect(out.kind).toBe("grounded");
    expect(out.sources).toHaveLength(1);
    expect(out.meta.provider).toBe("captain-adel");
  });

  it("sends the trusted-tier header when an api key is configured", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(REMOTE_OK));
    vi.stubGlobal("fetch", fetchMock);

    const { askRemote } = await loadRemote();
    await askRemote({ message: "q" }, cfg);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Adel-Api-Key"]).toBe("k");
  });

  it("omits the trusted-tier header when no api key is configured", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(REMOTE_OK));
    vi.stubGlobal("fetch", fetchMock);

    const { askRemote } = await loadRemote();
    await askRemote({ message: "q" }, { ...cfg, apiKey: "" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers as Record<string, string>).not.toHaveProperty("X-Adel-Api-Key");
  });

  it("forwards history and session when given", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(REMOTE_OK));
    vi.stubGlobal("fetch", fetchMock);

    const { askRemote } = await loadRemote();
    const history = [{ role: "user" as const, content: "earlier" }];
    await askRemote({ message: "q", history, session: "s-1" }, cfg);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      message: "q",
      history,
      product: "flygaca",
      session: "s-1",
    });
  });

  it("throws RemoteBrainError on a non-200, naming the status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "nope" }, 503)),
    );

    const { askRemote } = await loadRemote();
    const { RemoteBrainError } = await import("../src/remote-brain-core.js");
    await expect(askRemote({ message: "q" }, cfg)).rejects.toBeInstanceOf(RemoteBrainError);
    await expect(askRemote({ message: "q" }, cfg)).rejects.toThrow("503");
  });

  it("clears its abort timer on both the success and the failure path", async () => {
    const clear = vi.spyOn(globalThis, "clearTimeout");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(REMOTE_OK)),
    );
    const { askRemote } = await loadRemote();
    await askRemote({ message: "q" }, cfg);
    expect(clear).toHaveBeenCalled();

    clear.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const fresh = await loadRemote();
    await expect(fresh.askRemote({ message: "q" }, cfg)).rejects.toThrow("network down");
    expect(clear).toHaveBeenCalled();

    clear.mockRestore();
  });

  it("passes an abort signal so the timeout can cancel the request", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(REMOTE_OK));
    vi.stubGlobal("fetch", fetchMock);

    const { askRemote } = await loadRemote();
    await askRemote({ message: "q" }, cfg);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts when the timeout triggers", async () => {
    vi.useFakeTimers();
    let aborted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init: RequestInit) => {
        init.signal?.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise(() => {}); // never resolves
      }),
    );

    const { askRemote } = await loadRemote();
    const promise = askRemote({ message: "q" }, { ...cfg, timeoutMs: 100 });
    vi.advanceTimersByTime(150);
    expect(aborted).toBe(true);
    vi.useRealTimers();
  });
});

describe("brain seam", () => {
  it("reports no remote brain when ADEL_REMOTE_BASE_URL is unset", async () => {
    const { usingRemoteBrain } = await loadBrain();
    expect(usingRemoteBrain()).toBe(false);
  });

  it("reports a remote brain once ADEL_REMOTE_BASE_URL is set", async () => {
    process.env.ADEL_REMOTE_BASE_URL = "https://adel.example";
    const { usingRemoteBrain } = await loadBrain();
    expect(usingRemoteBrain()).toBe(true);
  });

  it("routes the buffered call to the remote service when configured", async () => {
    process.env.ADEL_REMOTE_BASE_URL = "https://adel.example";
    const fetchMock = vi.fn(async () => jsonResponse(REMOTE_OK));
    vi.stubGlobal("fetch", fetchMock);

    const { brain } = await loadBrain();
    const out = await brain({ message: "q" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe(
      "https://adel.example/v1/chat",
    );
    expect(out.answer).toBe(REMOTE_OK.answer);
  });

  it("emits the remote answer as a single stream chunk", async () => {
    process.env.ADEL_REMOTE_BASE_URL = "https://adel.example";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(REMOTE_OK)),
    );

    const { brain } = await loadBrain();
    const { stream, output } = brain.stream({ message: "q" });

    const chunks: string[] = [];
    for await (const c of stream) chunks.push(c);

    expect(chunks).toEqual([REMOTE_OK.answer]);
    expect((await output).kind).toBe("grounded");
  });
});
