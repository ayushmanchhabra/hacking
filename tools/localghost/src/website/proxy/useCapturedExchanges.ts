import { useEffect, useState } from "react";

import { capturedExchanges as fallbackExchanges } from "./data";
import { getServerBridge } from "./serverBridge";
import type { CapturedExchange } from "./types";

export function useCapturedExchanges(): CapturedExchange[] {
  const bridge = getServerBridge();
  const [exchanges, setExchanges] = useState<CapturedExchange[]>(
    () => bridge?.getExchanges() ?? fallbackExchanges,
  );

  useEffect(() => {
    if (!bridge) return;
    setExchanges(bridge.getExchanges());
    return bridge.onExchange((exchange) => {
      setExchanges((prev) => [...prev, exchange]);
    });
  }, [bridge]);

  return exchanges;
}
