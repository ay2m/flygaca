/**
 * Zero-dependency flow harness for streamable flows (DESIGN §3, §6.2).
 *
 * Replaces `@genkit-ai/core` to prevent OpenTelemetry runtime crashes
 * (specifically `core_1.getEnv is not a function`) during serverless bundling on Vercel.
 * Preserves the exact `defineFlow` interface and `.stream()` async iterable contract.
 */

export interface FlowContext<StreamChunk> {
  sendChunk: (chunk: StreamChunk) => void;
}

export type FlowHandler<Input, Output, StreamChunk> = (
  input: Input,
  context: FlowContext<StreamChunk>,
) => Promise<Output>;

export interface Flow<Input, Output, StreamChunk> {
  (input: Input, ctx?: { sendChunk?: (chunk: StreamChunk) => void }): Promise<Output>;
  stream(input: Input): {
    stream: AsyncIterable<StreamChunk>;
    output: Promise<Output>;
  };
}

export function defineFlow<
  InputSchema extends { _output: unknown },
  OutputSchema extends { _output: unknown },
  StreamChunk = string,
>(
  options: {
    name: string;
    inputSchema: InputSchema;
    outputSchema: OutputSchema;
    streamSchema?: unknown;
  },
  handler: FlowHandler<InputSchema["_output"], OutputSchema["_output"], StreamChunk>,
): Flow<InputSchema["_output"], OutputSchema["_output"], StreamChunk>;

export function defineFlow<Input, Output, StreamChunk = string>(
  options: {
    name: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
    streamSchema?: unknown;
  },
  handler: FlowHandler<Input, Output, StreamChunk>,
): Flow<Input, Output, StreamChunk>;

export function defineFlow<Input, Output, StreamChunk = string>(
  _options: {
    name: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
    streamSchema?: unknown;
  },
  handler: FlowHandler<Input, Output, StreamChunk>,
): Flow<Input, Output, StreamChunk> {
  const call = async (
    input: Input,
    ctx?: { sendChunk?: (chunk: StreamChunk) => void },
  ): Promise<Output> => {
    return handler(input, { sendChunk: ctx?.sendChunk ?? (() => {}) });
  };

  call.stream = (input: Input): { stream: AsyncIterable<StreamChunk>; output: Promise<Output> } => {
    type Event =
      | { type: "chunk"; value: StreamChunk }
      | { type: "end" }
      | { type: "error"; err: unknown };

    const queue: Event[] = [];
    let waiter: (() => void) | null = null;

    const push = (ev: Event) => {
      queue.push(ev);
      if (waiter) {
        const w = waiter;
        waiter = null;
        w();
      }
    };

    const output = handler(input, {
      sendChunk: (chunk) => push({ type: "chunk", value: chunk }),
    })
      .then((res) => {
        push({ type: "end" });
        return res;
      })
      .catch((err) => {
        push({ type: "error", err });
        throw err;
      });

    const stream: AsyncIterable<StreamChunk> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<StreamChunk>> {
            while (queue.length === 0) {
              await new Promise<void>((r) => {
                waiter = r;
              });
            }
            const ev = queue.shift()!;
            if (ev.type === "chunk") {
              return { done: false, value: ev.value };
            }
            if (ev.type === "error") {
              throw ev.err;
            }
            return { done: true, value: undefined };
          },
        };
      },
    };

    return { stream, output };
  };

  return call as Flow<Input, Output, StreamChunk>;
}
