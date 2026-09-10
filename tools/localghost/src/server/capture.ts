import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingHttpHeaders } from "node:http";
import {
  brotliDecompressSync,
  gunzipSync,
  inflateRawSync,
  inflateSync,
  zstdDecompressSync,
} from "node:zlib";

import type { CapturedExchange } from "../website/proxy/types.ts";

const MAX_EXCHANGES = 500;
const MAX_CAPTURED_BODY_BYTES = 1_000_000;

const exchanges: CapturedExchange[] = [];
const emitter = new EventEmitter();

export function getExchanges(): CapturedExchange[] {
  return exchanges.slice();
}

export function onExchange(
  listener: (exchange: CapturedExchange) => void,
): () => void {
  emitter.on("exchange", listener);
  return () => emitter.off("exchange", listener);
}

export function recordExchange(
  exchange: Omit<CapturedExchange, "id" | "time">,
): void {
  const entry: CapturedExchange = {
    id: randomUUID(),
    time: formatTime(new Date()),
    ...exchange,
  };
  exchanges.push(entry);
  if (exchanges.length > MAX_EXCHANGES) exchanges.shift();
  emitter.emit("exchange", entry);
}

// Collects response/request body chunks as they're piped through the
// proxy, capping memory use for large or streaming bodies.
export class BodyCollector {
  #chunks: Buffer[] = [];
  #bytes = 0;
  #truncated = false;

  push(chunk: Buffer): void {
    if (this.#bytes >= MAX_CAPTURED_BODY_BYTES) {
      this.#truncated = true;
      return;
    }
    this.#chunks.push(chunk);
    this.#bytes += chunk.length;
  }

  // Raw bytes as received (capped, like everything else this
  // collects). Used to replay a request body when interception
  // forwards it after holding it — a held body over the cap is
  // truncated the same way it would be for display.
  toBuffer(): Buffer {
    return Buffer.concat(this.#chunks);
  }

  // `contentEncoding` decompresses the captured copy for display; the
  // bytes actually piped to the client are untouched, so real browsing
  // is unaffected either way.
  toBody(contentEncoding?: string | string[]): string | undefined {
    if (this.#chunks.length === 0) return undefined;
    const raw = this.toBuffer();
    // A cut-off compressed stream won't decompress cleanly — show the
    // raw bytes rather than let decoding throw on a partial body.
    const body = this.#truncated
      ? raw.toString("utf8")
      : decodeBody(raw, contentEncoding);
    return this.#truncated ? `${body}\n…[truncated]` : body;
  }
}

// Content-Encoding lists transformations in the order they were
// applied, so they're undone in reverse. Falls back to raw bytes for
// an unrecognized encoding or a stream that fails to decompress.
function decodeBody(
  raw: Buffer,
  contentEncoding: string | string[] | undefined,
): string {
  const encodings = (
    Array.isArray(contentEncoding)
      ? contentEncoding.join(",")
      : (contentEncoding ?? "")
  )
    .split(",")
    .map((encoding) => encoding.trim().toLowerCase())
    .filter(Boolean)
    .reverse();

  let buffer = raw;
  try {
    for (const encoding of encodings) {
      switch (encoding) {
        case "gzip":
        case "x-gzip":
          buffer = gunzipSync(buffer);
          break;
        case "br":
          buffer = brotliDecompressSync(buffer);
          break;
        case "deflate":
          buffer = inflateDeflate(buffer);
          break;
        case "zstd":
          buffer = zstdDecompressSync(buffer);
          break;
        case "identity":
          break;
        default:
          return raw.toString("utf8");
      }
    }
    return buffer.toString("utf8");
  } catch {
    return raw.toString("utf8");
  }
}

// "deflate" is ambiguously specified: most servers send a zlib-wrapped
// stream, but some send raw DEFLATE.
function inflateDeflate(buffer: Buffer): Buffer {
  try {
    return inflateSync(buffer);
  } catch {
    return inflateRawSync(buffer);
  }
}

export function toHeaderPairs(
  headers: IncomingHttpHeaders,
): [string, string][] {
  const pairs: [string, string][] = [];
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) pairs.push([key, entry]);
    } else {
      pairs.push([key, value]);
    }
  }
  return pairs;
}

function formatTime(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
