import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getModel, streamChat } from "./api.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Mocks fetch with a streamed body delivered in the given raw chunks. */
function mockStream(chunks: string[], status = 200) {
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
          controller.close();
        },
      }),
      { status },
    );
}

test("streamChat reassembles NDJSON lines split across network chunks", async () => {
  const lines = [
    { message: { thinking: "let me think" }, done: false },
    { message: { content: "Hello" }, done: false },
    { message: { content: ", world" }, done: false },
    { done: true },
  ].map((l) => JSON.stringify(l) + "\n").join("");
  // Split at awkward offsets so JSON objects straddle chunk boundaries.
  mockStream([lines.slice(0, 7), lines.slice(7, 50), lines.slice(50)]);

  let content = "";
  let thinking = "";
  await streamChat(
    [{ role: "user", content: "hi" }],
    true,
    (d) => {
      content += d.content;
      thinking += d.thinking;
    },
    new AbortController().signal,
  );
  assert.equal(content, "Hello, world");
  assert.equal(thinking, "let me think");
});

test("streamChat throws on an in-stream error chunk", async () => {
  mockStream([JSON.stringify({ error: "model not found", done: true }) + "\n"]);
  await assert.rejects(
    streamChat([], true, () => {}, new AbortController().signal),
    /model not found/,
  );
});

test("streamChat throws on a non-2xx response", async () => {
  mockStream(["upstream down"], 502);
  await assert.rejects(
    streamChat([], true, () => {}, new AbortController().signal),
    /502/,
  );
});

test("getModel returns the server's model status", async () => {
  globalThis.fetch = async () => Response.json({ model: "qwen3.6", ready: true });
  assert.deepEqual(await getModel(), { model: "qwen3.6", ready: true });
});
