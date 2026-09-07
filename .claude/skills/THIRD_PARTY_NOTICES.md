# Third-Party Notices — vendored Claude Code skills

This directory contains skills vendored from third-party, community-maintained sources. They are
developer tooling for Claude Code only; they are not part of any shipped product and are never
served to end users.

## Vendored Skills

### Context7 (Upstash)

- **Project:** Context7 — live documentation and API lookup for 1000+ libraries
- **Author:** Upstash
- **Source:** https://github.com/upstash/context7
- **License:** MIT (upstream `LICENSE` retained)
- **Pinned upstream commit:** Latest (no pin — uses `npx ctx7@latest`)
- **Skill:** `find-docs` — retrieve current documentation, API references, and code examples for any developer technology

### Superpowers (Jesse Vincent)

- **Project:** Superpowers — AI-native workflow orchestration for Claude Code
- **Author:** Jesse Vincent (@obra)
- **Source:** https://github.com/obra/superpowers
- **License:** MIT (upstream `LICENSE` retained)
- **Pinned upstream commit:** Latest
- **Skills vendored:**
  - `dispatching-parallel-agents` — coordinate multiple independent subagent tasks
  - (Captain-Adel also vendors: `executing-plans` — execute composed multi-step plans)
  - (Office also vendors: `writing-plans` — structure proposals and strategy docs)

### Claude-Mem (Mark Thibault)

- **Project:** Claude-Mem — persistent memory and context management for Claude Code sessions
- **Author:** Mark Thibault (@thedotmack)
- **Source:** https://github.com/thedotmack/claude-mem
- **License:** Apache License 2.0 (upstream `LICENSE` retained)
- **Pinned upstream commit:** Latest
- **Skills vendored:**
  - `mem-search` — search memory index for context and prior work
  - (Office also vendors: `mem-setup` — configure cloud sync credentials)

### Humanizer (blader)

- **Project:** Humanizer — rewrites AI-sounding prose to read like a person wrote it, without
  changing what it says
- **Author:** blader (Siqi Chen)
- **Source:** https://github.com/blader/humanizer
- **License:** MIT (upstream `LICENSE` retained)
- **Pinned upstream commit:** `9862685f575c65a8247f90369951df1b3416e3d6` (v3.0.0)
- **Skill:** `humanizer` — the whole upstream repo, a single self-contained `SKILL.md` with no
  bundled scripts or assets, so nothing was trimmed

**Where it applies here:** guide copy under `content/`, marketing sections, pricing/upgrade CTAs,
release notes, PR descriptions, and this repo's own `CLAUDE.md`/`docs/` prose — anywhere AI-drafted
English or Arabic copy needs to read like a person wrote it before it ships. Run it after
`flygaca-content-seo` or `marketing-copywriting` drafts a page, not instead of them — humanizer
edits tone and rhythm, it does not decide structure, SEO metadata, or offer terms.

**Guardrail:** never run it over regulatory quotes, GACAR citations, calculator output, `ar.json`
translation strings outside a full i18n review, or the disclaimer language that must match the
other Fly GACA surfaces verbatim — the skill's own rule ("a name, number, date, quote, or citation
must come from the source") already protects factual content, but exact-wording legal and
regulatory text should not go through a rewrite pass at all.

## What was intentionally omitted

For each vendored skill, only `SKILL.md`, `references/**`, and the upstream `LICENSE` were copied.
Bundled `scripts/`, `assets/`, and plugin manifests were omitted to avoid introducing unreviewed
third-party executables. If a skill workflow refers to a helper script, consult the upstream
repository.

## Registration as marketplaces

Additionally, this repo's `.claude/settings.json` registers the following sources as **known
marketplaces**, allowing on-demand installation of the full skill set:

- `upstash/context7` — 4 skills (library docs lookup)
- `obra/superpowers` — 12+ workflow and agent skills
- `thedotmack/claude-mem` — memory, learning, and context management skills
- `blader/humanizer` — the same single skill vendored above, registered so `/plugin install
  humanizer@humanizer` can pull upstream's latest version for comparison. Registered but not
  enabled: enabling it would put two skills named `humanizer` on the path at once.

## License compliance

All vendored skills and their upstream sources are permissively licensed (MIT or Apache 2.0),
permitting commercial use, modification, and redistribution with attribution. This repo retains
the upstream `LICENSE` file in each skill directory.
