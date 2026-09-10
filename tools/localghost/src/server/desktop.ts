// Entry point bundled to src/desktop/server.js and run as NW.js's
// "node-main" background script. Starts the forward proxy with the
// defaults documented for FoxyProxy (127.0.0.1:8080) and exposes the
// capture API on `module.exports`, reachable from the window's DOM
// context via `process.mainModule.exports`.
import { exportCACertificate, getCACertificateInfo } from "./ca.ts";
import { getExchanges, onExchange } from "./capture.ts";
import {
  dropPendingRequest,
  forwardPendingRequest,
  getPendingRequests,
  isInterceptEnabled,
  onPendingRequest,
  onPendingRequestResolved,
  setInterceptEnabled,
} from "./intercept.ts";
import { createProxyServer } from "./proxy.ts";

const HOST = "127.0.0.1";
const PORT = 8080;

const server = createProxyServer();

server.on("error", (err) => {
  console.error(`[proxy] server error: ${err.message}`);
});

server.listen(PORT, HOST, () => {
  console.log(`[proxy] listening on http://${HOST}:${PORT}`);
});

export {
  dropPendingRequest,
  exportCACertificate,
  forwardPendingRequest,
  getCACertificateInfo,
  getExchanges,
  getPendingRequests,
  isInterceptEnabled,
  onExchange,
  onPendingRequest,
  onPendingRequestResolved,
  setInterceptEnabled,
};
