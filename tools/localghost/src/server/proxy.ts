import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import https from "node:https";
import { type Socket } from "node:net";
import tls from "node:tls";

import { getLeafCertificate, type LeafCertificate } from "./ca.ts";
import { BodyCollector, recordExchange, toHeaderPairs } from "./capture.ts";
import { awaitInterceptDecision, isInterceptEnabled } from "./intercept.ts";
import type { HttpMethod } from "../website/proxy/types.ts";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function stripHopByHopHeaders(
  headers: IncomingHttpHeaders,
): http.OutgoingHttpHeaders {
  const forwarded: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      continue;
    }
    forwarded[key] = value;
  }
  return forwarded;
}

function formatHost(
  hostname: string,
  port: number,
  defaultPort: number,
): string {
  return port === defaultPort ? hostname : `${hostname}:${port}`;
}

interface ProxyTarget {
  scheme: "http" | "https";
  hostname: string;
  port: number;
}

// Forwards a request to `target`, capturing the full exchange. Used both
// for plain-HTTP requests (an absolute-URI request-target) and for
// requests decrypted off an intercepted HTTPS tunnel (a relative
// request-target, with the target known from the CONNECT that preceded
// it — see handleConnect). When interception is on, the request is
// held (fully buffered, not yet sent anywhere) until the UI forwards or
// drops it.
function proxyRequest(
  clientReq: IncomingMessage,
  clientRes: ServerResponse,
  target: ProxyTarget,
  path: string,
): void {
  const method = (clientReq.method ?? "GET").toUpperCase() as HttpMethod;
  const client = target.scheme === "https" ? https : http;
  const defaultPort = target.scheme === "https" ? 443 : 80;
  const host = formatHost(target.hostname, target.port, defaultPort);

  const requestBody = new BodyCollector();
  clientReq.on("data", (chunk: Buffer) => requestBody.push(chunk));

  // `replayBody`, when given, is the already-buffered body of a
  // request that was held for interception — it's written directly
  // instead of live-piping clientReq (which has already ended by then).
  function sendUpstream(replayBody?: Buffer): void {
    const upstreamReq = client.request(
      {
        hostname: target.hostname,
        port: target.port,
        method: clientReq.method,
        path,
        headers: stripHopByHopHeaders(clientReq.headers),
        ...(target.scheme === "https" ? { servername: target.hostname } : {}),
      },
      (upstreamRes) => {
        clientRes.writeHead(
          upstreamRes.statusCode ?? 502,
          stripHopByHopHeaders(upstreamRes.headers),
        );
        upstreamRes.pipe(clientRes);

        const responseBody = new BodyCollector();
        upstreamRes.on("data", (chunk: Buffer) => responseBody.push(chunk));
        upstreamRes.on("end", () => {
          recordExchange({
            request: {
              method,
              scheme: target.scheme,
              host,
              path,
              headers: toHeaderPairs(clientReq.headers),
              body: requestBody.toBody(clientReq.headers["content-encoding"]),
            },
            response: {
              status: upstreamRes.statusCode ?? 0,
              statusText: upstreamRes.statusMessage ?? "",
              headers: toHeaderPairs(upstreamRes.headers),
              body: responseBody.toBody(
                upstreamRes.headers["content-encoding"],
              ),
            },
          });
        });
      },
    );

    upstreamReq.on("error", (err) => {
      console.error(
        `[proxy] upstream error for ${target.scheme}://${target.hostname}:${target.port}${path}: ${err.message}`,
      );
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { "Content-Type": "text/plain" });
      }
      clientRes.end("Bad Gateway");
    });

    if (replayBody) {
      if (replayBody.length > 0) upstreamReq.write(replayBody);
      upstreamReq.end();
    } else {
      clientReq.pipe(upstreamReq);
    }
  }

  if (!isInterceptEnabled()) {
    sendUpstream();
    return;
  }

  clientReq.on("end", () => {
    void awaitInterceptDecision({
      method,
      scheme: target.scheme,
      host,
      path,
      headers: toHeaderPairs(clientReq.headers),
      body: requestBody.toBody(clientReq.headers["content-encoding"]),
    }).then((decision) => {
      // The browser may have already given up while this sat held.
      if (clientRes.writableEnded || clientRes.destroyed) return;
      if (decision === "drop") {
        clientRes
          .writeHead(502, { "Content-Type": "text/plain" })
          .end("Dropped by intercept.");
        return;
      }
      sendUpstream(requestBody.toBuffer());
    });
  });
}

// Handles a plain-HTTP request whose request-target is an absolute-URI,
// e.g. "GET http://example.com/path HTTP/1.1" — how clients address a
// forward proxy, as opposed to an origin server.
function handleRequest(
  clientReq: IncomingMessage,
  clientRes: ServerResponse,
): void {
  let target: URL;
  try {
    target = new URL(clientReq.url ?? "");
  } catch {
    clientRes
      .writeHead(400, { "Content-Type": "text/plain" })
      .end("Bad Request: expected an absolute-form request target.");
    return;
  }

  const scheme = target.protocol === "https:" ? "https" : "http";
  const port = target.port
    ? Number(target.port)
    : scheme === "https"
      ? 443
      : 80;
  const path = `${target.pathname}${target.search}`;

  proxyRequest(
    clientReq,
    clientRes,
    { scheme, hostname: target.hostname, port },
    path,
  );
  console.log(`[proxy] ${clientReq.method} ${target.href}`);
}

// Handles a request decrypted off an intercepted HTTPS tunnel. Post
// -CONNECT requests use origin-form (a relative path plus a Host
// header), so the target — known since the CONNECT that preceded this
// tunnel — is passed in rather than parsed from the request line.
function handleInterceptedRequest(
  clientReq: IncomingMessage,
  clientRes: ServerResponse,
  hostname: string,
  port: number,
): void {
  const path = clientReq.url ?? "/";
  proxyRequest(clientReq, clientRes, { scheme: "https", hostname, port }, path);
  console.log(`[proxy] ${clientReq.method} https://${hostname}${path}`);
}

// Handles CONNECT, which browsers use to tunnel HTTPS through the
// proxy. Rather than relaying opaque bytes, this terminates TLS with a
// certificate minted for the target host (signed by the local CA — see
// ca.ts) and re-encrypts outbound to the real origin, so requests and
// responses can be parsed and captured like plain HTTP.
function handleConnect(
  clientReq: IncomingMessage,
  clientSocket: Socket,
  head: Buffer,
): void {
  const [hostname, portStr] = (clientReq.url ?? "").split(":");
  const port = Number(portStr) || 443;

  if (!hostname) {
    clientSocket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }

  let leaf: LeafCertificate;
  try {
    leaf = getLeafCertificate(hostname);
  } catch (err) {
    console.error(
      `[proxy] failed to mint a certificate for ${hostname}: ${(err as Error).message}`,
    );
    clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    return;
  }

  clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
  // Anything the HTTP parser already read past the CONNECT headers is
  // the start of the client's TLS handshake — put it back so the
  // TLSSocket below sees it.
  if (head.length > 0) clientSocket.unshift(head);

  const tlsSocket = new tls.TLSSocket(clientSocket, {
    isServer: true,
    cert: leaf.certPem,
    key: leaf.keyPem,
    ALPNProtocols: ["http/1.1"],
  });

  tlsSocket.on("error", (err) => {
    console.error(
      `[proxy] TLS handshake error for ${hostname}: ${err.message}`,
    );
  });

  // http.Server normally parses requests off sockets it accepted
  // itself; emit("connection", ...) hands it one we've already
  // decrypted instead, so it dispatches parsed requests the same way.
  const interceptServer = http.createServer((req, res) =>
    handleInterceptedRequest(req, res, hostname, port),
  );
  interceptServer.on("clientError", (_err, socket) => {
    if (socket.writable) socket.end();
  });
  interceptServer.emit("connection", tlsSocket);

  console.log(`[proxy] CONNECT ${hostname}:${port} (intercepting)`);
}

export function createProxyServer(): http.Server {
  const server = http.createServer(handleRequest);
  server.on("connect", handleConnect);
  return server;
}
