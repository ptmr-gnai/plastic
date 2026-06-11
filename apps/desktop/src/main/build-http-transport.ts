import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { EventStore, MethodRegistry } from "@plastic/core";
import { handleHttpEventStream, handleHttpMethodGet, handleHttpRpc, sendJson, startHttpTransportServer } from "./runtime-http-transport.js";
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
  const corsOrigin = input.corsOrigin ?? "*";
  return startHttpTransportServer({
    eventStore: input.eventStore,
    host: input.host,
    port: input.port,
    runPromise: input.runPromise,
    ...(input.onListening ? { onListening: input.onListening } : {}),
    handleRequest: ({ eventStreamClients, request, response }) =>
      handleBuildRequest({ corsOrigin, eventStreamClients, input, request, response })
  });
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
    handleHttpEventStream({ corsOrigin, eventStreamClients, request, response });
    return;
  }
  if (await handleHttpMethodGet({
    corsOrigin,
    methodByPath: buildMethodByPath,
    methods: input.methods,
    request,
    response,
    runPromise: input.runPromise
  })) {
    return;
  }
  if (request.method === "POST" && request.url === "/rpc") {
    await handleHttpRpc({ corsOrigin, methods: input.methods, request, response, runPromise: input.runPromise });
    return;
  }
  sendJson(response, 404, { ok: false, error: "Not found" }, corsOrigin);
};

const buildMethodByPath: Record<string, string> = {
  "/capabilities": "runtime/capabilities",
  "/methods": "plastic/methods",
  "/snapshot": "plastic/snapshot",
  "/state": "plastic/state",
  "/status": "build/status"
};
