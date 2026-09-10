import { useEffect, useState } from "react";

import {
  getServerBridge,
  type PendingInterceptedRequest,
} from "./serverBridge";

export function usePendingRequests(): PendingInterceptedRequest[] {
  const bridge = getServerBridge();
  const [pending, setPending] = useState<PendingInterceptedRequest[]>(
    () => bridge?.getPendingRequests() ?? [],
  );

  useEffect(() => {
    if (!bridge) return;
    setPending(bridge.getPendingRequests());

    const unsubscribeAdded = bridge.onPendingRequest((entry) => {
      setPending((prev) => [...prev, entry]);
    });
    const unsubscribeResolved = bridge.onPendingRequestResolved((id) => {
      setPending((prev) => prev.filter((entry) => entry.id !== id));
    });

    return () => {
      unsubscribeAdded();
      unsubscribeResolved();
    };
  }, [bridge]);

  return pending;
}
