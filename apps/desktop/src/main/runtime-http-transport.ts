import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  type EventStore,
  type MethodRegistry
} from "@plastic/core";
import type { RunPromise } from "./runtime-method-context.js";

export type RuntimeHttpTransport = {
  server: Server;
  close: () => void;
};

export const readJsonBody = async (request: IncomingMessage | NodeJS.ReadableStream): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      if (body.trim().length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });

export const sendJson = (
  response: ServerResponse,
  statusCode: number,
  value: unknown,
  corsOrigin = "*"
) => {
  response.writeHead(statusCode, {
    "access-control-allow-origin": corsOrigin,
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "content-type": "application/json"
  });
  response.end(JSON.stringify(value));
};

export const writeSse = (response: ServerResponse, event: string, data: unknown) => {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
};

export const handleHttpEventStream = (input: {
  corsOrigin: string;
  eventStreamClients: Set<ServerResponse>;
  request: IncomingMessage;
  response: ServerResponse;
}) => {
  const { corsOrigin, eventStreamClients, request, response } = input;
  response.writeHead(200, {
    "access-control-allow-origin": corsOrigin,
    "cache-control": "no-cache",
    "connection": "keep-alive",
    "content-type": "text/event-stream"
  });
  eventStreamClients.add(response);
  writeSse(response, "plastic.ready", { ok: true });
  request.on("close", () => {
    eventStreamClients.delete(response);
  });
};

export const handleHttpRpc = async (input: {
  corsOrigin: string;
  methods: MethodRegistry;
  request: IncomingMessage;
  response: ServerResponse;
  runPromise: RunPromise;
}) => {
  try {
    const body = await readJsonBody(input.request) as { method?: string; input?: unknown };
    if (!body.method) {
      throw new Error("RPC request requires method");
    }
    const value = await input.runPromise(input.methods.call(body.method, body.input));
    sendJson(input.response, 200, { ok: true, value }, input.corsOrigin);
  } catch (error) {
    sendJson(input.response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }, input.corsOrigin);
  }
};

export const startRuntimeHttpTransport = async (input: {
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
  host: string;
  port: number;
  corsOrigin?: string;
  onListening?: () => void;
}): Promise<RuntimeHttpTransport> => {
  const eventStreamClients = new Set<ServerResponse>();
  const corsOrigin = input.corsOrigin ?? "*";
  const unsubscribe = await input.runPromise(
    input.eventStore.subscribe((event) => {
      for (const response of eventStreamClients) {
        writeSse(response, "plastic.event", event);
      }
    })
  );

  const server = createServer((request, response) => {
    void handleRuntimeRequest({
      eventStreamClients,
      input,
      request,
      response,
      corsOrigin
    });
  });

  server.listen(input.port, input.host, input.onListening);

  return {
    server,
    close: () => {
      unsubscribe();
      for (const response of eventStreamClients) {
        response.end();
      }
      eventStreamClients.clear();
      server.close();
    }
  };
};

const handleRuntimeRequest = async (context: {
  eventStreamClients: Set<ServerResponse>;
  input: Parameters<typeof startRuntimeHttpTransport>[0];
  request: IncomingMessage;
  response: ServerResponse;
  corsOrigin: string;
}) => {
  const { eventStreamClients, input, request, response, corsOrigin } = context;
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {}, corsOrigin);
    return;
  }

  try {
    if (await handleRuntimeGet({ eventStreamClients, input, request, response, corsOrigin })) {
      return;
    }
    if (request.method === "POST" && request.url === "/rpc") {
      await handleHttpRpc({ corsOrigin, methods: input.methods, request, response, runPromise: input.runPromise });
      return;
    }
    sendJson(response, 404, { ok: false, error: "Not found" }, corsOrigin);
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }, corsOrigin);
  }
};

const handleRuntimeGet = async (context: {
  eventStreamClients: Set<ServerResponse>;
  input: Parameters<typeof startRuntimeHttpTransport>[0];
  request: IncomingMessage;
  response: ServerResponse;
  corsOrigin: string;
}) => {
  const { eventStreamClients, input, request, response, corsOrigin } = context;
  if (request.method !== "GET") {
    return false;
  }
  if (request.url === "/healthz") {
    sendJson(response, 200, { ok: true, service: "plastic.runtime" }, corsOrigin);
    return true;
  }
  if (request.url === "/state") {
    const state = await input.runPromise(input.methods.call("plastic/state", {}));
    sendJson(response, 200, { ok: true, value: state }, corsOrigin);
    return true;
  }
  if (request.url === "/methods") {
    const value = await input.runPromise(input.methods.call("plastic/methods", {}));
    sendJson(response, 200, { ok: true, value }, corsOrigin);
    return true;
  }
  if (request.url === "/events/stream") {
    handleHttpEventStream({ corsOrigin, eventStreamClients, request, response });
    return true;
  }
  return false;
};
