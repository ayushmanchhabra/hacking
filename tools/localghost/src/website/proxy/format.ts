import type { CapturedExchange, CapturedRequest, HttpMethod } from "./types";

export function rawRequest(request: CapturedRequest): string {
  const lines = [
    `${request.method} ${request.path} HTTP/1.1`,
    ...request.headers.map(([name, value]) => `${name}: ${value}`),
  ];
  return request.body
    ? `${lines.join("\n")}\n\n${request.body}`
    : lines.join("\n");
}

export function rawResponse(entry: CapturedExchange): string {
  const { response } = entry;
  const lines = [
    `HTTP/1.1 ${response.status} ${response.statusText}`,
    ...response.headers.map(([name, value]) => `${name}: ${value}`),
  ];
  return response.body
    ? `${lines.join("\n")}\n\n${response.body}`
    : lines.join("\n");
}

const METHOD_COLOR: Record<HttpMethod, string> = {
  GET: "text-sky-400 border-sky-400/30 bg-sky-400/10",
  HEAD: "text-neutral-400 border-neutral-400/30 bg-neutral-400/10",
  POST: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10",
  PUT: "text-amber-400 border-amber-400/30 bg-amber-400/10",
  PATCH: "text-violet-400 border-violet-400/30 bg-violet-400/10",
  DELETE: "text-rose-400 border-rose-400/30 bg-rose-400/10",
  OPTIONS: "text-neutral-400 border-neutral-400/30 bg-neutral-400/10",
};

export function methodColor(method: HttpMethod): string {
  return METHOD_COLOR[method];
}

export function statusColor(status: number): string {
  if (status < 300)
    return "text-emerald-400 border-emerald-400/30 bg-emerald-400/10";
  if (status < 400) return "text-sky-400 border-sky-400/30 bg-sky-400/10";
  if (status < 500) return "text-amber-400 border-amber-400/30 bg-amber-400/10";
  return "text-rose-400 border-rose-400/30 bg-rose-400/10";
}
