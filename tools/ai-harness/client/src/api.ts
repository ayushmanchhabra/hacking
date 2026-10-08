export type Role = "system" | "user" | "assistant";

export interface Message {
  role: Role;
  content: string;
  thinking?: string;
}

interface ChatChunk {
  message?: { content?: string; thinking?: string };
  done: boolean;
  error?: string;
}

/** Streams a chat completion via the Express /api/chat proxy (NDJSON), calling onChunk per delta. */
export async function streamChat(
  messages: Message[],
  think: boolean,
  onChunk: (delta: { content: string; thinking: string }) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, think }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Chat failed (${res.status}): ${await res.text()}`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      const chunk: ChatChunk = JSON.parse(line);
      if (chunk.error) throw new Error(chunk.error);
      onChunk({
        content: chunk.message?.content ?? "",
        thinking: chunk.message?.thinking ?? "",
      });
    }
  }
}

export async function getModel(): Promise<{ model: string; ready: boolean }> {
  const res = await fetch("/api/model");
  return res.json();
}
