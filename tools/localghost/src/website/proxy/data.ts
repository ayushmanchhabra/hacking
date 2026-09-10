import type { CapturedExchange } from "./types";

export const capturedExchanges: CapturedExchange[] = [
  {
    id: "1",
    time: "14:02:11",
    request: {
      method: "GET",
      scheme: "https",
      host: "api.target.dev",
      path: "/v1/session",
      headers: [
        ["Host", "api.target.dev"],
        ["User-Agent", "localghost/0.0.0"],
        ["Accept", "application/json"],
        ["Cookie", "session=8f3a1c2e9b"],
      ],
    },
    response: {
      status: 200,
      statusText: "OK",
      headers: [
        ["Content-Type", "application/json"],
        ["Content-Length", "58"],
      ],
      body: '{"userId":1042,"role":"member","mfaEnabled":false}',
    },
  },
  {
    id: "2",
    time: "14:02:14",
    request: {
      method: "POST",
      scheme: "https",
      host: "api.target.dev",
      path: "/v1/auth/login",
      headers: [
        ["Host", "api.target.dev"],
        ["User-Agent", "localghost/0.0.0"],
        ["Content-Type", "application/json"],
        ["Content-Length", "47"],
      ],
      body: '{"username":"admin","password":"changeme123"}',
    },
    response: {
      status: 401,
      statusText: "Unauthorized",
      headers: [
        ["Content-Type", "application/json"],
        ["Content-Length", "33"],
      ],
      body: '{"error":"invalid_credentials"}',
    },
  },
  {
    id: "3",
    time: "14:02:19",
    request: {
      method: "GET",
      scheme: "https",
      host: "api.target.dev",
      path: "/v1/users?limit=25&offset=0",
      headers: [
        ["Host", "api.target.dev"],
        ["User-Agent", "localghost/0.0.0"],
        ["Accept", "application/json"],
        ["Cookie", "session=8f3a1c2e9b"],
      ],
    },
    response: {
      status: 200,
      statusText: "OK",
      headers: [
        ["Content-Type", "application/json"],
        ["Content-Length", "612"],
      ],
      body: '[{"id":1,"email":"root@target.dev"},{"id":2,"email":"dev@target.dev"}]',
    },
  },
  {
    id: "4",
    time: "14:02:23",
    request: {
      method: "PUT",
      scheme: "https",
      host: "api.target.dev",
      path: "/v1/users/2/role",
      headers: [
        ["Host", "api.target.dev"],
        ["User-Agent", "localghost/0.0.0"],
        ["Content-Type", "application/json"],
        ["Cookie", "session=8f3a1c2e9b"],
      ],
      body: '{"role":"admin"}',
    },
    response: {
      status: 403,
      statusText: "Forbidden",
      headers: [
        ["Content-Type", "application/json"],
        ["Content-Length", "40"],
      ],
      body: '{"error":"insufficient_permissions"}',
    },
  },
  {
    id: "5",
    time: "14:02:27",
    request: {
      method: "GET",
      scheme: "https",
      host: "api.target.dev",
      path: "/v1/users/../../etc/passwd",
      headers: [
        ["Host", "api.target.dev"],
        ["User-Agent", "localghost/0.0.0"],
        ["Accept", "*/*"],
      ],
    },
    response: {
      status: 404,
      statusText: "Not Found",
      headers: [
        ["Content-Type", "application/json"],
        ["Content-Length", "26"],
      ],
      body: '{"error":"not_found"}',
    },
  },
  {
    id: "6",
    time: "14:02:31",
    request: {
      method: "POST",
      scheme: "https",
      host: "api.target.dev",
      path: "/v1/reports",
      headers: [
        ["Host", "api.target.dev"],
        ["User-Agent", "localghost/0.0.0"],
        ["Content-Type", "application/json"],
        ["Cookie", "session=8f3a1c2e9b"],
      ],
      body: '{"title":"Q3 findings","format":"pdf"}',
    },
    response: {
      status: 201,
      statusText: "Created",
      headers: [
        ["Content-Type", "application/json"],
        ["Location", "/v1/reports/91"],
      ],
      body: '{"id":91,"status":"queued"}',
    },
  },
  {
    id: "7",
    time: "14:02:36",
    request: {
      method: "DELETE",
      scheme: "https",
      host: "api.target.dev",
      path: "/v1/reports/91",
      headers: [
        ["Host", "api.target.dev"],
        ["User-Agent", "localghost/0.0.0"],
        ["Cookie", "session=8f3a1c2e9b"],
      ],
    },
    response: {
      status: 500,
      statusText: "Internal Server Error",
      headers: [
        ["Content-Type", "application/json"],
        ["Content-Length", "31"],
      ],
      body: '{"error":"unexpected_failure"}',
    },
  },
  {
    id: "8",
    time: "14:02:40",
    request: {
      method: "GET",
      scheme: "https",
      host: "cdn.target.dev",
      path: "/static/build.js",
      headers: [
        ["Host", "cdn.target.dev"],
        ["User-Agent", "localghost/0.0.0"],
        ["Accept", "*/*"],
      ],
    },
    response: {
      status: 301,
      statusText: "Moved Permanently",
      headers: [["Location", "https://cdn.target.dev/static/build.min.js"]],
    },
  },
];
