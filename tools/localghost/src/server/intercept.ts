import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import type { CapturedRequest } from "../website/proxy/types.ts";

export interface PendingInterceptedRequest extends CapturedRequest {
  id: string;
}

type Decision = "forward" | "drop";

const emitter = new EventEmitter();
const pending = new Map<string, PendingInterceptedRequest>();
const resolvers = new Map<string, (decision: Decision) => void>();

let enabled = false;

export function isInterceptEnabled(): boolean {
  return enabled;
}

// Turning interception off releases anything currently held, so a
// request that was paused mid-flight doesn't hang forever waiting for
// a Forward/Drop that can no longer come.
export function setInterceptEnabled(value: boolean): void {
  enabled = value;
  if (!enabled) {
    for (const id of [...resolvers.keys()]) resolveDecision(id, "forward");
  }
}

export function getPendingRequests(): PendingInterceptedRequest[] {
  return [...pending.values()];
}

export function onPendingRequest(
  listener: (entry: PendingInterceptedRequest) => void,
): () => void {
  emitter.on("pending", listener);
  return () => emitter.off("pending", listener);
}

export function onPendingRequestResolved(
  listener: (id: string) => void,
): () => void {
  emitter.on("resolved", listener);
  return () => emitter.off("resolved", listener);
}

// Holds `request` until forwardPendingRequest/dropPendingRequest (or
// interception being turned off) releases it.
export function awaitInterceptDecision(
  request: CapturedRequest,
): Promise<Decision> {
  const entry: PendingInterceptedRequest = { id: randomUUID(), ...request };
  return new Promise((resolve) => {
    pending.set(entry.id, entry);
    resolvers.set(entry.id, resolve);
    emitter.emit("pending", entry);
  });
}

function resolveDecision(id: string, decision: Decision): void {
  const resolve = resolvers.get(id);
  if (!resolve) return;
  resolvers.delete(id);
  pending.delete(id);
  resolve(decision);
  emitter.emit("resolved", id);
}

export function forwardPendingRequest(id: string): void {
  resolveDecision(id, "forward");
}

export function dropPendingRequest(id: string): void {
  resolveDecision(id, "drop");
}
