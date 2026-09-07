/**
 * The Captain Adel RAG flow's server-side grounding logic (DESIGN §3 D3) — the
 * safety-critical part: grounding is decided from retrieval confidence, NOT
 * trusted to the model. A low-confidence retrieval yields a deterministic
 * cite-the-rule refusal and the model is never called, so a fabricated GACAR
 * figure can't be emitted. Genkit's flow wrapper, the model client, corpus
 * retrieval and telemetry are mocked; buildSystem and the params stay real.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  hits: [] as { entry: Record<string, unknown>; score: number; matched: number }[],
  queryTerms: 4,
  generated: "2026-01-01",
  streamChunks: ["Under ", "GACAR..."] as string[],
  sent: [] as string[],
  generateCalls: 0,
  lastModel: undefined as unknown,
  lastHistory: undefined as unknown,
}));

// A zod stand-in: every access/call returns the same proxy, so the module's
// schema construction at import time never throws (schemas are unused at runtime
// here — the mocked defineFlow ignores them).
const zStub: unknown = new Proxy(function () {}, {
  get: () => zStub,
  apply: () => zStub,
});

vi.mock("../src/flow.js", () => ({
  defineFlow: (
    _cfg: unknown,
    handler: (input: unknown, ctx: { sendChunk: (c: string) => void }) => unknown,
  ) =>
    Object.assign((input: unknown) => handler(input, { sendChunk: (c) => h.sent.push(c) }), {
      stream: (input: unknown) => ({
        stream: (async function* () {})(),
        output: handler(input, { sendChunk: (c) => h.sent.push(c) }),
      }),
    }),
}));

// The model client stands in for the configured model endpoint. It yields the
// deltas the flow must both forward and accumulate, and records the model id it
// was asked for so tier selection stays pinned.
vi.mock("../src/model.js", () => ({
  ModelError: class ModelError extends Error {},
  streamChat: async function* (input: { model: string; history?: unknown[] }) {
    h.generateCalls += 1;
    h.lastModel = input.model;
    h.lastHistory = input.history;
    for (const c of h.streamChunks) yield c;
  },
}));
vi.mock("@genkit-ai/firebase", () => ({ enableFirebaseTelemetry: vi.fn() }));

vi.mock("../src/corpus.js", () => ({
  getIndex: () =>
    Promise.resolve({
      generated: h.generated,
      search: () => h.hits,
      queryTermCount: () => h.queryTerms,
    }),
  toChatSource: (entry: Record<string, unknown>, generated: string) => ({
    citation: entry.__cite,
    url: "/library",
    section: entry.__section,
    corpusVersion: `Rev ${generated}`,
  }),
}));

type Flow = {
  (input: unknown): Promise<{
    answer: string;
    sources: unknown[];
    kind: string;
    refusalClass?: string;
    meta: { provider: string; retrieved: number; corpusVersion: string };
  }>;
};

let captainAdelFlow: Flow;

beforeAll(async () => {
  Object.assign(process.env, { RETRIEVE_K: "6" });
  captainAdelFlow = (await import("../src/captain-adel.js")).captainAdelFlow as unknown as Flow;
});

// `matched` is how many distinct query terms the passage contains — the signal
// the grounding gate keys off. `h.queryTerms` is the denominator; together they
// decide refusal/partial/grounded (see grounding-core.test.ts for the measured
// corpus values these stand in for).
const hit = (score: number, matched = 4) => ({
  entry: { x: "verbatim passage", __cite: "GACAR Part 61 §61.107", __section: "61.107" },
  score,
  matched,
});

beforeEach(() => {
  h.hits = [];
  h.queryTerms = 4;
  h.sent = [];
  h.generateCalls = 0;
  h.lastModel = undefined;
  h.lastHistory = undefined;
  h.streamChunks = ["Under ", "GACAR..."];
});

describe("captainAdelFlow — refusal (grounding decided server-side)", () => {
  // NOTE: retrieval is mocked empty here, so this pins the *plumbing* — an empty
  // result never reaches the model. Whether a real off-topic question actually
  // retrieves nothing is decided by the gate, covered against measured corpus
  // values in grounding-core.test.ts.
  it("refuses without calling the model when nothing is retrieved", async () => {
    const out = await captainAdelFlow({ message: "what is the airspeed of an unladen swallow?" });
    expect(out.kind).toBe("refusal");
    expect(out.answer).toContain("couldn't find this in the GACAR regulatory corpus");
    expect(out.sources).toEqual([]);
    expect(out.refusalClass).toBeUndefined();
    expect(out.meta.retrieved).toBe(0);
    expect(h.generateCalls).toBe(0); // the model is never invoked
  });

  it("refuses on a below-threshold top score and reports the closest section", async () => {
    h.hits = [hit(1.0)]; // below the score floor, however good the term overlap
    const out = await captainAdelFlow({ message: "borderline query" });
    expect(out.kind).toBe("refusal");
    expect(out.refusalClass).toBe("61.107"); // section of the closest (rejected) hit
    expect(h.generateCalls).toBe(0);
  });
});

describe("captainAdelFlow — answered (model called)", () => {
  it("returns a 'partial' verdict for a mid-confidence retrieval and streams tokens", async () => {
    // On topic but the question ranged wider than the passage: 3 of 8 terms.
    h.queryTerms = 8;
    h.hits = [hit(2.0, 3)];
    const out = await captainAdelFlow({ message: "aeronautical experience" });
    expect(out.kind).toBe("partial");
    // The returned answer is the streamed deltas joined — one source of truth,
    // so the text the client saw and the text the flow returns cannot diverge.
    expect(out.answer).toBe("Under GACAR...");
    expect(out.sources).toHaveLength(1);
    expect(h.generateCalls).toBe(1);
    expect(h.sent).toEqual(["Under ", "GACAR..."]); // streamed deltas forwarded via sendChunk
  });

  it("maps prior history turns (user + assistant) into the model call", async () => {
    h.hits = [hit(5.0)];
    const out = await captainAdelFlow({
      message: "follow-up",
      history: [
        { role: "user", content: "first question" },
        { role: "assistant", content: "prior answer" },
      ],
    });
    expect(out.kind).toBe("grounded");
    expect(h.generateCalls).toBe(1);
    // Mapped to chat-completions roles ("assistant", not Genkit's "model").
    expect(h.lastHistory).toEqual([
      { role: "user", content: "first question" },
      { role: "assistant", content: "prior answer" },
    ]);
  });

  it("returns a 'grounded' verdict for a high-confidence retrieval", async () => {
    h.hits = [hit(5.0)]; // all 4 query terms present in the passage
    const out = await captainAdelFlow({ message: "clear match" });
    expect(out.kind).toBe("grounded");
    expect(out.meta.corpusVersion).toBe("Rev 2026-01-01");
  });
});

describe("captainAdelFlow — model selection", () => {
  // Ids come from MODEL_ID_FAST / MODEL_ID_PRO; these are the config defaults.
  it("defaults to the fast tier", async () => {
    h.hits = [hit(5.0)];
    const out = await captainAdelFlow({ message: "q" });
    expect(out.meta.provider).toBe("gemini-2.5-flash");
    expect(h.lastModel).toBe("gemini-2.5-flash");
  });

  it("selects the pro model when the request asks for the pro tier", async () => {
    h.hits = [hit(5.0)];
    const out = await captainAdelFlow({ message: "q", provider: "pro" });
    expect(out.meta.provider).toBe("gemini-2.5-pro");
    expect(h.lastModel).toBe("gemini-2.5-pro");
  });
});
