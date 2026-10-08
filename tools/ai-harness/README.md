# AI Harness

Local LLM chat: Ollama runs [qwen3.6](https://ollama.com/library/qwen3.6), and an Express server proxies it to a React chat UI.

```
browser ──► web (Express :3000 → host :8080) ──► ollama (:11434, internal only)
              serves React build + /api/chat
```

## Layout

| Folder | Contents |
| --- | --- |
| [client/](client/) | React + Vite chat UI |
| [server/](server/) | Express server: serves the client build and proxies `/api` to Ollama |
| [ai/](ai/) | Ollama entrypoint that pulls `OLLAMA_MODEL` on first boot |
| [devops/](devops/) | Docker Compose, Dockerfiles and `.env` |

## Getting Started

1. `cp devops/.env.example devops/.env` and pick a model tag (default `qwen3.6`, ~24GB).
1. `docker compose -f devops/docker-compose.yml up -d --build`. On first run Ollama downloads the model, and `web` starts once it is ready. Follow progress with `docker compose -f devops/docker-compose.yml logs -f ollama`.
1. Open <http://localhost:8080>.

With an NVIDIA GPU, add `-f devops/docker-compose.gpu.yml` to the command.

Models persist in the `ollama` volume. `docker compose -f devops/docker-compose.yml down -v` deletes them.

## Hardware

`qwen3.6` (35B-A3B MoE) needs ~24GB of RAM or VRAM. Hosts with less should set `OLLAMA_MODEL` to a smaller tag, or to a different model family entirely.

## API

| Route | Description |
| --- | --- |
| `GET /api/model` | `{ model, ready }`. `ready` is true once the model is pulled. |
| `POST /api/chat` | Body `{ messages, think }`. Streams Ollama's NDJSON chat chunks (`message.thinking` / `message.content`). |

The model is fixed server-side by `OLLAMA_MODEL`; clients can't choose it.

## Development

Run the UI with hot reload against a running Ollama:

1. `cd server && npm i && OLLAMA_URL=http://localhost:11434 npm start` starts Express on :3000.
1. `cd client && npm i && npm run dev` starts Vite, which proxies `/api` to :3000.

## Testing

`docker compose -f devops/docker-compose.yml run --rm --build test` runs the client (Vitest) and server (`node:test`) suites against a fake Ollama, so it needs no model download. The `ai-harness` GitHub Action runs this same command.

Without Docker: `npm --prefix client test && npm --prefix server test`.
