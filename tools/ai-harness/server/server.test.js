import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "./server.js";

const listen = (server) =>
  new Promise((resolve) =>
    server.listen(0, () => resolve(`http://localhost:${server.address().port}`)),
  );

let fakeOllama, harness, base;
let lastChatBody;

before(async () => {
  // Stand-in for Ollama: one pulled model, and a chat endpoint that streams NDJSON.
  fakeOllama = http.createServer((req, res) => {
    if (req.url === "/api/tags") {
      res.end(JSON.stringify({ models: [{ name: "test-model:latest" }] }));
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      lastChatBody = JSON.parse(body);
      res.write(JSON.stringify({ message: { thinking: "hmm" }, done: false }) + "\n");
      res.write(JSON.stringify({ message: { content: "hi" }, done: false }) + "\n");
      res.end(JSON.stringify({ done: true }) + "\n");
    });
  });
  const ollamaUrl = await listen(fakeOllama);

  const dist = await mkdtemp(path.join(tmpdir(), "ai-harness-dist-"));
  await writeFile(path.join(dist, "index.html"), "<title>AI Harness</title>");

  harness = http.createServer(createApp({ ollamaUrl, model: "test-model", dist }));
  base = await listen(harness);
});

after(() => {
  fakeOllama.close();
  harness.close();
});

test("GET /api/model reports the configured model as ready", async () => {
  const res = await fetch(`${base}/api/model`);
  assert.deepEqual(await res.json(), { model: "test-model", ready: true });
});

test("GET /api/model reports not ready when Ollama is down", async () => {
  const app = http.createServer(createApp({ ollamaUrl: "http://localhost:1", model: "x" }));
  const url = await listen(app);
  try {
    const res = await fetch(`${url}/api/model`);
    assert.deepEqual(await res.json(), { model: "x", ready: false });
  } finally {
    app.close();
  }
});

test("POST /api/chat streams NDJSON and pins the server-side model", async () => {
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "attacker-choice",
      think: false,
      messages: [{ role: "user", content: "hello", extra: "dropped" }],
    }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/x-ndjson");

  const chunks = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(chunks.length, 3);
  assert.equal(chunks[1].message.content, "hi");

  assert.equal(lastChatBody.model, "test-model");
  assert.equal(lastChatBody.think, false);
  assert.equal(lastChatBody.stream, true);
  assert.deepEqual(lastChatBody.messages, [{ role: "user", content: "hello" }]);
});

test("POST /api/chat rejects a body without messages", async () => {
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

test("POST /api/chat returns 502 when Ollama is unreachable", async () => {
  const app = http.createServer(createApp({ ollamaUrl: "http://localhost:1", model: "x" }));
  const url = await listen(app);
  try {
    const res = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    assert.equal(res.status, 502);
  } finally {
    app.close();
  }
});

test("unknown routes fall back to the client's index.html", async () => {
  const res = await fetch(`${base}/some/client/route`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /AI Harness/);
});
