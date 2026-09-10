export type HttpMethod =
  "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

export interface CapturedRequest {
  method: HttpMethod;
  scheme: "http" | "https";
  host: string;
  path: string;
  headers: [string, string][];
  body?: string;
}

export interface CapturedResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body?: string;
}

export interface CapturedExchange {
  id: string;
  time: string;
  request: CapturedRequest;
  response: CapturedResponse;
}
