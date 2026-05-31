#!/usr/bin/env node

import { createInterface } from "node:readline";

const rpcUrl = process.env.PLASTIC_RPC_URL ?? "http://127.0.0.1:7331/rpc";
const actorId = process.env.PLASTIC_MCP_ACTOR_ID ?? "plastic.mcp";

const send = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const sendResult = (id, result) => {
  send({ jsonrpc: "2.0", id, result });
};

const sendError = (id, code, message) => {
  send({ jsonrpc: "2.0", id, error: { code, message } });
};

const callPlastic = async (method, input = {}) => {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, input })
  });
  const result = await response.json();
  if (!result.ok) {
    throw new Error(result.error ?? `Plastic RPC failed for ${method}`);
  }
  return result.value;
};

const appendBridgeEvent = async (type, payload) => {
  try {
    await callPlastic("events/append", {
      type,
      payload,
      scope: { agentId: actorId }
    });
  } catch (error) {
    process.stderr.write(`[plastic-mcp] failed to append ${type}: ${error instanceof Error ? error.message : String(error)}\n`);
  }
};

const tool = {
  name: "plastic_rpc",
  description: "Call any registered Plastic RPC method through the shared Plastic method registry.",
  inputSchema: {
    type: "object",
    properties: {
      method: {
        type: "string",
        description: "Plastic RPC method id, for example plastic/state or chats/createCodexChat."
      },
      input: {
        type: "object",
        additionalProperties: true,
        description: "Input payload for the method."
      }
    },
    required: ["method"],
    additionalProperties: false
  }
};

const handleRequest = async (message) => {
  const { id, method, params } = message;
  if (id === undefined && method?.startsWith("notifications/")) {
    return;
  }

  if (method === "initialize") {
    sendResult(id, {
      protocolVersion: params?.protocolVersion ?? "2024-11-05",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "plastic", version: "0.0.0" }
    });
    return;
  }

  if (method === "ping") {
    sendResult(id, {});
    return;
  }

  if (method === "tools/list") {
    sendResult(id, { tools: [tool], nextCursor: null });
    return;
  }

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    if (name !== "plastic_rpc") {
      sendResult(id, {
        content: [{ type: "text", text: JSON.stringify({ ok: false, error: `Unknown tool: ${name}` }) }],
        isError: true
      });
      return;
    }

    const methodId = typeof args.method === "string" ? args.method : "";
    const input = args.input && typeof args.input === "object" ? args.input : {};
    if (!methodId) {
      sendResult(id, {
        content: [{ type: "text", text: JSON.stringify({ ok: false, error: "plastic_rpc requires method" }) }],
        isError: true
      });
      return;
    }

    const startedAt = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    await appendBridgeEvent("bridge.plastic_rpc.requested", {
      correlationId,
      method: methodId,
      input,
      rpcUrl,
      startedAt
    });

    try {
      const value = await callPlastic(methodId, input);
      const result = { ok: true, value };
      await appendBridgeEvent("bridge.plastic_rpc.completed", {
        correlationId,
        method: methodId,
        ok: true,
        completedAt: new Date().toISOString()
      });
      sendResult(id, { content: [{ type: "text", text: JSON.stringify(result) }] });
    } catch (error) {
      const result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      await appendBridgeEvent("bridge.plastic_rpc.completed", {
        correlationId,
        method: methodId,
        ok: false,
        error: result.error,
        completedAt: new Date().toISOString()
      });
      sendResult(id, { content: [{ type: "text", text: JSON.stringify(result) }], isError: true });
    }
    return;
  }

  if (id !== undefined) {
    sendError(id, -32601, `Method not found: ${method}`);
  }
};

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  if (line.trim().length === 0) {
    return;
  }
  void (async () => {
    try {
      await handleRequest(JSON.parse(line));
    } catch (error) {
      process.stderr.write(`[plastic-mcp] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    }
  })();
});
