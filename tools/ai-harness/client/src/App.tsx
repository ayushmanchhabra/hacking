import { useEffect, useRef, useState } from "react";
import { getModel, streamChat, type Message } from "./api";

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [think, setThink] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<{ model: string; ready: boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getModel().then(setModel, () => setModel(null));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const history: Message[] = [...messages, { role: "user", content: text }];
    setMessages([...history, { role: "assistant", content: "", thinking: "" }]);
    setInput("");
    setError(null);
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChat(
        history,
        think,
        ({ content, thinking }) =>
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            return [
              ...prev.slice(0, -1),
              {
                ...last,
                content: last.content + content,
                thinking: (last.thinking ?? "") + thinking,
              },
            ];
          }),
        controller.signal,
      );
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="app">
      <header>
        <h1>AI Harness</h1>
        <span className={`model ${model?.ready === false ? "missing" : ""}`}>
          {model?.model ?? "…"}
          {model?.ready === false && " · not pulled yet"}
        </span>
        <label className="toggle">
          <input
            type="checkbox"
            checked={think}
            onChange={(e) => setThink(e.target.checked)}
          />
          Thinking
        </label>
        <button
          className="ghost"
          onClick={() => setMessages([])}
          disabled={busy || messages.length === 0}
        >
          Clear
        </button>
      </header>

      <main>
        {messages.length === 0 && (
          <p className="empty">Ask {model?.model ?? "the model"} anything.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.thinking && (
              <details open={busy && i === messages.length - 1 && !m.content}>
                <summary>Thinking</summary>
                <pre>{m.thinking}</pre>
              </details>
            )}
            <div className="content">
              {m.content ||
                (busy && i === messages.length - 1 ? "…" : "")}
            </div>
          </div>
        ))}
        {error && <div className="error">{error}</div>}
        <div ref={bottomRef} />
      </main>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          value={input}
          placeholder="Message… (Enter to send, Shift+Enter for newline)"
          rows={2}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {busy ? (
          <button type="button" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()}>
            Send
          </button>
        )}
      </form>
    </div>
  );
}
