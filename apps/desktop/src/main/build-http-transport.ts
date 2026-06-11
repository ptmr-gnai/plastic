import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { EventStore, MethodRegistry } from "@plastic/core";
import type { RpcRequest } from "../shared/ipc.js";
import { readJsonBody, sendJson, writeSse } from "./runtime-http-transport.js";
import type { RunPromise } from "./runtime-method-context.js";

export type BuildHttpTransport = {
  server: Server;
  close: () => void;
};

type BuildHttpTransportInput = {
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
  host: string;
  port: number;
  getStatus: () => unknown;
  corsOrigin?: string;
  onListening?: () => void;
};

export const startBuildHttpTransport = async (input: BuildHttpTransportInput): Promise<BuildHttpTransport> => {
  const eventStreamClients = new Set<ServerResponse>();
  const unsubscribe = await input.runPromise(
    input.eventStore.subscribe((event) => {
      for (const response of eventStreamClients) {
        writeSse(response, "plastic.event", event);
      }
    })
  );

  const server = createServer(async (request, response) => {
    await handleBuildRequest({
      eventStreamClients,
      input,
      request,
      response,
      corsOrigin: input.corsOrigin ?? "*"
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

const handleBuildRequest = async (context: {
  eventStreamClients: Set<ServerResponse>;
  input: BuildHttpTransportInput;
  request: IncomingMessage;
  response: ServerResponse;
  corsOrigin: string;
}) => {
  const { corsOrigin, eventStreamClients, input, request, response } = context;
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {}, corsOrigin);
    return;
  }
  if (request.method === "GET" && request.url === "/healthz") {
    sendJson(response, 200, { ok: true, service: "plastic.build" }, corsOrigin);
    return;
  }
  if (request.method === "GET" && request.url === "/events/stream") {
    handleBuildEventStream({ corsOrigin, eventStreamClients, request, response });
    return;
  }
  if (await handleBuildMethodGet({ corsOrigin, input, request, response })) {
    return;
  }
  if (request.method === "POST" && request.url === "/rpc") {
    await handleBuildRpc({ corsOrigin, input, request, response });
    return;
  }
  sendJson(response, 404, { ok: false, error: "Not found" }, corsOrigin);
};

const handleBuildMethodGet = async (context: {
  corsOrigin: string;
  input: BuildHttpTransportInput;
  request: IncomingMessage;
  response: ServerResponse;
}) => {
  const methodByPath: Record<string, string> = {
    "/methods": "plastic/methods",
    "/snapshot": "plastic/snapshot",
    "/state": "plastic/state",
    "/status": "build/status"
  };
  const method = context.request.method === "GET" ? methodByPath[context.request.url ?? ""] : undefined;
  if (!method) {
    return false;
  }
  try {
    const value = await context.input.runPromise(context.input.methods.call(method, {}));
    sendJson(context.response, 200, { ok: true, value }, context.corsOrigin);
  } catch (error) {
    sendJson(context.response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }, context.corsOrigin);
  }
  return true;
};

const handleBuildEventStream = (context: {
  corsOrigin: string;
  eventStreamClients: Set<ServerResponse>;
  request: IncomingMessage;
  response: ServerResponse;
}) => {
  const { corsOrigin, eventStreamClients, request, response } = context;
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

const handleBuildRpc = async (context: {
  corsOrigin: string;
  input: BuildHttpTransportInput;
  request: IncomingMessage;
  response: ServerResponse;
}) => {
  try {
    const body = await readJsonBody(context.request) as RpcRequest;
    if (!body.method) {
      throw new Error("RPC request requires method");
    }
    const value = await context.input.runPromise(context.input.methods.call(body.method, body.input));
    sendJson(context.response, 200, { ok: true, value }, context.corsOrigin);
  } catch (error) {
    sendJson(context.response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }, context.corsOrigin);
  }
};
