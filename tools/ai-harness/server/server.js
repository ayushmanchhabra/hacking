import express from "express";
import path from "node:path";
import { Readable } from "node:stream";

export function createApp({
  ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434",
  model = process.env.OLLAMA_MODEL ?? "qwen3.6",
  dist = path.resolve(
    process.env.CLIENT_DIST ?? path.join(import.meta.dirname, "../client/dist"),
  ),
} = {}) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  /** Reports the configured model and whether Ollama has it pulled. */
  app.get("/api/model", async (_req, res) => {
    try {
      const r = await fetch(`${ollamaUrl}/api/tags`);
      const { models } = await r.json();
      const want = model.includes(":") ? model : `${model}:latest`;
      res.json({ model, ready: models.some((m) => m.name === want) });
    } catch {
      res.json({ model, ready: false });
    }
  });

  /** Streams Ollama's NDJSON chat response straight through to the browser. */
  app.post("/api/chat", async (req, res) => {
    const { messages, think = true } = req.body ?? {};
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages must be an array" });
    }

    const controller = new AbortController();
    res.on("close", () => controller.abort());

    try {
      const upstream = await fetch(`${ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: true,
          think,
          messages: messages.map(({ role, content }) => ({ role, content })),
        }),
        signal: controller.signal,
      });
      res.status(upstream.status);
      res.setHeader("Content-Type", "application/x-ndjson");
      Readable.fromWeb(upstream.body).pipe(res);
    } catch (e) {
      if (controller.signal.aborted) return;
      res.status(502).json({ error: `Ollama unreachable: ${e.message}` });
    }
  });

  app.use(express.static(dist));
  app.get("/{*splat}", (_req, res) =>
    res.sendFile(path.join(dist, "index.html")),
  );

  return app;
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => {
    console.log(
      `ai-harness on :${port} → ${process.env.OLLAMA_URL ?? "http://localhost:11434"} (${process.env.OLLAMA_MODEL ?? "qwen3.6"})`,
    );
  });
}
