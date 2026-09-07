import { describe, expect, it } from "vitest";
import { defineFlow } from "../src/flow.js";

describe("defineFlow", () => {
  it("executes buffered flow returning output", async () => {
    const flow = defineFlow(
      { name: "testFlow" },
      async (input: { name: string }, { sendChunk }) => {
        sendChunk("Hello ");
        sendChunk(input.name);
        return { greeting: `Hello ${input.name}` };
      },
    );

    const result = await flow({ name: "Captain" });
    expect(result).toEqual({ greeting: "Hello Captain" });
  });

  it("streams chunks through async iterator and resolves output", async () => {
    const flow = defineFlow(
      { name: "testStreamFlow" },
      async (input: { count: number }, { sendChunk }) => {
        for (let i = 1; i <= input.count; i++) {
          sendChunk(`chunk-${i}`);
        }
        return { total: input.count };
      },
    );

    const { stream, output } = flow.stream({ count: 3 });
    const collected: string[] = [];
    for await (const chunk of stream) {
      collected.push(chunk);
    }

    expect(collected).toEqual(["chunk-1", "chunk-2", "chunk-3"]);
    const res = await output;
    expect(res).toEqual({ total: 3 });
  });

  it("propagates errors through streaming call", async () => {
    const flow = defineFlow({ name: "testErrorFlow" }, async () => {
      throw new Error("flow-failed");
    });

    const { stream, output } = flow.stream({});
    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of stream) {
        // no-op
      }
    }).rejects.toThrow("flow-failed");

    await expect(output).rejects.toThrow("flow-failed");
  });
});
