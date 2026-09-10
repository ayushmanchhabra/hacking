import { parseArgs } from "node:util";

export interface ProxyCliOptions {
  host: string;
  port: number;
  protocol: "http";
  exportCa?: string;
}

const SUPPORTED_PROTOCOLS = ["http"];

export function parseCliArgs(argv: string[]): ProxyCliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: "8080" },
      protocol: { type: "string", default: "http" },
      "export-ca": { type: "string" },
    },
  });

  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid --port "${values.port}": must be an integer between 1 and 65535.`,
    );
  }

  if (!SUPPORTED_PROTOCOLS.includes(values.protocol as string)) {
    throw new Error(
      `Invalid --protocol "${values.protocol}": supported protocols are ${SUPPORTED_PROTOCOLS.join(", ")}.`,
    );
  }

  return {
    host: values.host as string,
    port,
    protocol: values.protocol as "http",
    exportCa: values["export-ca"] as string | undefined,
  };
}
