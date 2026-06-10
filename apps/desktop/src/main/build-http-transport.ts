import { createServer, type Server } from "node:http";
import type { MethodRegistry } from "@plastic/core";
import type { RpcRequest } from "../shared/ipc.js";
import { readJsonBody, sendJson } from "./runtime-http-transport.js";
import type { RunPromise } from "./runtime-method-context.js";

export type BuildHttpTransport = {
  server: Server;
  close: () => void;
};

export const startBuildHttpTransport = (input: {
  methods: MethodRegistry;
  runPromise: RunPromise;
  host: string;
  port: number;
  getStatus: () => unknown;
  onListening?: () => void;
}): BuildHttpTransport => {
  const server = createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      sendJson(response, 204, {});
      return;
    }

    if (request.method === "GET" && request.url === "/healthz") {
      sendJson(response, 200, { ok: true, service: "plastic.build" });
      return;
    }

    if (request.method === "GET" && request.url === "/status") {
      sendJson(response, 200, {
        ok: true,
        value: input.getStatus()
      });
      return;
    }

    if (request.method === "GET" && request.url === "/snapshot") {
      try {
        sendJson(response, 200, { ok: true, value: await input.runPromise(input.methods.call("plastic/snapshot", {})) });
      } catch (error) {
        sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (request.method === "POST" && request.url === "/rpc") {
      try {
        const body = await readJsonBody(request) as RpcRequest;
        const value = await input.runPromise(input.methods.call(body.method, body.input));
        sendJson(response, 200, { ok: true, value });
      } catch (error) {
        sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    sendJson(response, 404, { ok: false, error: "Not found" });
  });

  server.listen(input.port, input.host, input.onListening);

  return {
    server,
    close: () => server.close()
  };
};
