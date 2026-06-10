import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Effect } from "effect";
import { createEvent, type EventStore, type MethodRegistry } from "@plastic/core";
import { registerCodexChatMethods } from "./codex-chat-method-registration.js";
import { createCodexMessageHandler } from "./codex-message-handler.js";
import {
  registerCodexAliasMethods,
  registerCodexBridgeMethods,
  registerCodexCoreMethods
} from "./codex-method-registration.js";

export interface CodexRpcMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export interface PendingRequest {
  method: string;
  params?: unknown;
  sentEventId?: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface CodexAdapter {
  status: () => unknown;
  registerMethods: () => Promise<void>;
}

export const createCodexAdapter = (input: {
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: <A>(effect: Effect.Effect<A, unknown>) => Promise<A>;
  workspaceDir?: string;
  runtimeRpcUrl?: string;
  runtimeRpcUrls?: string[];
}): CodexAdapter => {
  let processHandle: ChildProcessWithoutNullStreams | null = null;
  let nextId = 1;
  let initialized = false;
  let plasticMcpConfigured = false;
  let plasticMcpLastError: string | null = null;
  let bridgeMcpThreadId: string | null = null;
  let connectedAt: string | null = null;
  const pending = new Map<number, PendingRequest>();
  const threadChatBindings = new Map<string, string>();

  const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" ? value as Record<string, unknown> : {};

  const asString = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;

  const runtimeRpcUrl = input.runtimeRpcUrl ?? "http://127.0.0.1:7331/rpc";
  const runtimeRpcUrls = input.runtimeRpcUrls ?? [runtimeRpcUrl];
  const workspaceDir = input.workspaceDir ?? process.cwd();
  const plasticMcpServerPath = join(workspaceDir, "scripts", "plastic-mcp-server.mjs");
  const fallbackCodexModel = process.env.PLASTIC_CODEX_MODEL ?? "gpt-5.4-mini";
  let currentCodexDefaults = { model: fallbackCodexModel };

  const appendCodexEvent = (type: string, payload: unknown) =>
    input.runPromise(
      input.eventStore.append(
        createEvent({
          type,
          payload,
          scope: { agentId: "codex" },
          actor: {
            kind: "agent",
            id: "codex",
            name: "Codex"
          }
        })
      )
    );

  const getCodexDefaults = async () => {
    const events = await input.runPromise(input.eventStore.list());
    let latest: (typeof events)[number] | undefined;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index]?.type === "codex.defaults.updated") {
        latest = events[index];
        break;
      }
    }
    const payload = asRecord(latest?.payload);
    currentCodexDefaults = {
      model: asString(payload.model) ?? fallbackCodexModel
    };
    return currentCodexDefaults;
  };

  const appendChatAgentEvent = (type: string, payload: Record<string, unknown>) => {
    const threadId = asString(payload.threadId);
    const chatId = threadId ? threadChatBindings.get(threadId) : undefined;
    if (!chatId) {
      return;
    }

    void input.runPromise(
      input.eventStore.append(
        createEvent({
          type,
          payload: {
            chatId,
            ...payload
          },
          scope: {
            panelId: chatId,
            agentId: "codex"
          },
          actor: {
            kind: "agent",
            id: "codex",
            name: "Codex"
          }
        })
      )
    );
  };

  const send = (message: CodexRpcMessage) => {
    if (!processHandle) {
      throw new Error("Codex app-server is not connected");
    }
    processHandle.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const respondToServerRequest = (id: number, result: unknown) => {
    send({ id, result });
  };

  const rejectServerRequest = (id: number, error: unknown) => {
    send({
      id,
      error: error instanceof Error ? { message: error.message } : { message: String(error) }
    });
  };

  const request = async (method: string, params?: unknown): Promise<unknown> => {
    const id = nextId;
    nextId += 1;
    const sentEvent = await appendCodexEvent("codex.request.sent", {
      id,
      method,
      params
    });
    send({ id, method, params });
    return new Promise((resolve, reject) => {
      pending.set(id, {
        method,
        params,
        sentEventId: sentEvent.id,
        resolve,
        reject
      });
    });
  };

  const notify = (method: string, params?: unknown) => {
    void appendCodexEvent("codex.notification.sent", { method, params });
    send({ method, params });
  };

  const requestAlias = (method: string, methodInput: unknown) => request(method, methodInput);

  const configurePlasticMcp = async () => {
    const value = {
      command: "node",
      args: [plasticMcpServerPath],
      env: {
        PLASTIC_RPC_URL: runtimeRpcUrl,
        PLASTIC_MCP_ACTOR_ID: "plastic.mcp"
      },
      default_tools_enabled: true
    };

    try {
      const writeResult = await request("config/value/write", {
        keyPath: "mcp_servers.plastic",
        value,
        mergeStrategy: "upsert"
      });
      const reloadResult = await request("config/mcpServer/reload");
      plasticMcpConfigured = true;
      plasticMcpLastError = null;
      await appendCodexEvent("bridge.plastic_mcp.configured", {
        server: "plastic",
        tool: "plastic_rpc",
        path: plasticMcpServerPath,
        runtimeRpcUrl,
        writeResult,
        reloadResult
      });
      return { configured: true, value, writeResult, reloadResult };
    } catch (error) {
      plasticMcpConfigured = false;
      plasticMcpLastError = error instanceof Error ? error.message : String(error);
      await appendCodexEvent("bridge.plastic_mcp.configure_failed", {
        server: "plastic",
        tool: "plastic_rpc",
        path: plasticMcpServerPath,
        runtimeRpcUrl,
        error: plasticMcpLastError
      });
      throw error;
    }
  };

  const bindThreadToChat = async (chatId: string, threadId: string, reason: string) => {
    for (const [existingThreadId, existingChatId] of threadChatBindings.entries()) {
      if (existingChatId === chatId && existingThreadId !== threadId) {
        threadChatBindings.delete(existingThreadId);
      }
    }
    threadChatBindings.set(threadId, chatId);
    await input.runPromise(
      input.eventStore.append(
        createEvent({
          type: "chat.codex_thread.bound",
          payload: {
            chatId,
            threadId,
            reason
          },
          scope: {
            panelId: chatId,
            agentId: "codex"
          }
        })
      )
    );
  };

  const getBoundThreadId = async (chatId: string): Promise<string | undefined> => {
    for (const [threadId, boundChatId] of threadChatBindings.entries()) {
      if (boundChatId === chatId) {
        return threadId;
      }
    }

    const events = await input.runPromise(input.eventStore.list());
    const binding = events
      .filter((event) => event.type === "chat.codex_thread.bound")
      .map((event) => asRecord(event.payload))
      .filter((payload) => payload.chatId === chatId)
      .at(-1);
    const threadId = asString(binding?.threadId);
    if (threadId) {
      threadChatBindings.set(threadId, chatId);
    }
    return threadId;
  };

  const getChatBinding = async (chatId: string) => {
    const threadId = await getBoundThreadId(chatId);
    const events = await input.runPromise(input.eventStore.list());
    let activeTurnId: string | null = null;
    let activeTurnStatus: string | null = null;
    for (const event of events) {
      if (event.scope.panelId !== chatId) {
        continue;
      }
      const payload = asRecord(event.payload);
      if (event.type === "chat.codex_turn.started") {
        const turn = asRecord(payload.turn);
        activeTurnId = asString(turn.id) ?? activeTurnId;
        activeTurnStatus = asString(turn.status) ?? "inProgress";
      }
      if (event.type === "chat.codex_turn.completed") {
        activeTurnId = asString(payload.turnId) ?? activeTurnId;
        activeTurnStatus = asString(payload.status) ?? "completed";
      }
      if (event.type === "chat.turn.interrupted") {
        activeTurnId = asString(payload.turnId) ?? activeTurnId;
        activeTurnStatus = "interrupted";
      }
    }
    return {
      chatId,
      runtimeId: "codex",
      threadId: threadId ?? null,
      activeTurnId,
      activeTurnStatus
    };
  };

  const developerInstructionsForChat = (chatId: string) => [
    "You are an agent embodied inside Plastic, an agent-native Electron workspace.",
    `Your current chat panel id is ${chatId}.`,
    `Plastic RPC is the control bus. Preferred endpoint: ${runtimeRpcUrl}.`,
    `Fallback endpoints: ${runtimeRpcUrls.join(", ")}.`,
    "You have an MCP tool named plastic_rpc. Prefer that tool for Plastic RPC calls because command sandboxes may not open local TCP sockets.",
    "plastic_rpc input is { method: string, input?: object }. It returns the exact Plastic RPC result as JSON text.",
    "Use the HTTP bus for app control only if plastic_rpc is unavailable. Do not assume 127.0.0.1 works; use PLASTIC_RPC_URL or the preferred endpoint first.",
    `Before mutating the app or answering orientation questions, call plastic_rpc with method agent/orient and input {"panelId":${JSON.stringify(chatId)}}.`,
    "Use the returned eventCursor on later agent/orient or events/timeline calls to learn what changed since you last looked.",
    "After mutating Plastic, verify with the orientation packet's recommended actions, visible refs, screenshots, timeline, or build/typecheck methods.",
    "Call plastic/state before guessing panel ids. It returns panels, methods, links, actions, windows, visible refs, and event counts.",
    "RPC shape: POST the JSON object {\"method\":\"plastic/state\",\"input\":{}} to the bus URL with content-type application/json.",
    "To create another chat, call method chats/createCodexChat. To send a mailbox message between panels, call panels/sendMessage. To make another chat agent react, call chats/sendToCodex for that target chat.",
    "Everything meaningful should go through Plastic RPC and the durable event stream."
  ].join("\n");

  const startThreadForChat = async (chatId: string, payload: {
    cwd?: string;
    reason: string;
  }) => {
    const defaults = await getCodexDefaults();
    const threadResult = await request("thread/start", {
      cwd: payload.cwd ?? input.workspaceDir,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      model: defaults.model,
      personality: "friendly",
      serviceName: "plastic",
      developerInstructions: developerInstructionsForChat(chatId)
    });
    const thread = asRecord(asRecord(threadResult).thread);
    const threadId = asString(thread.id);
    if (!threadId) {
      throw new Error("Codex thread/start did not return thread.id");
    }
    await bindThreadToChat(chatId, threadId, payload.reason);
    return { threadId, threadResult };
  };

  const threadStartPayload = (reason: string, cwd?: string) => {
    const payload: { reason: string; cwd?: string } = { reason };
    if (cwd) {
      payload.cwd = cwd;
    }
    return payload;
  };

  const isThreadNotFoundError = (error: unknown) =>
    error instanceof Error && error.message.includes("thread not found");

  const handleMessage = createCodexMessageHandler({
    pending,
    methods: input.methods,
    runPromise: input.runPromise,
    appendCodexEvent,
    appendChatAgentEvent,
    respondToServerRequest,
    rejectServerRequest,
    asRecord,
    asString
  });

  const connect = async (codexPath = "codex") => {
    if (processHandle) {
      return {
        connected: true,
        initialized,
        pid: processHandle.pid ?? null,
        connectedAt
      };
    }

    processHandle = spawn(codexPath, ["app-server", "--listen", "stdio://"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PLASTIC_RPC_URL: runtimeRpcUrl,
        PLASTIC_RPC_URLS: runtimeRpcUrls.join(","),
        PLASTIC_RUNTIME_PORT: String(new URL(runtimeRpcUrl).port || 7331)
      }
    });
    connectedAt = new Date().toISOString();

    const lines = createInterface({ input: processHandle.stdout });
    lines.on("line", (line) => {
      if (line.trim().length === 0) {
        return;
      }
      try {
        handleMessage(JSON.parse(line) as CodexRpcMessage);
      } catch (error) {
        void appendCodexEvent("codex.message.parse_failed", {
          line,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    processHandle.stderr.on("data", (chunk: Buffer) => {
      void appendCodexEvent("codex.stderr", {
        text: chunk.toString("utf8")
      });
    });

    processHandle.on("exit", (code, signal) => {
      void appendCodexEvent("codex.connection.exited", { code, signal });
      processHandle = null;
      initialized = false;
      for (const requestState of pending.values()) {
        requestState.reject(new Error("Codex app-server exited"));
      }
      pending.clear();
    });

    await appendCodexEvent("codex.connection.started", {
      pid: processHandle.pid ?? null,
      codexPath
    });

    return {
      connected: true,
      initialized,
      pid: processHandle.pid ?? null,
      connectedAt
    };
  };

  const initialize = async () => {
    await connect();
    const result = await request("initialize", {
      clientInfo: {
        name: "plastic",
        title: "Plastic",
        version: "0.0.0"
      },
      capabilities: {
        experimentalApi: true
      }
    });
    notify("initialized");
    initialized = true;
    await appendCodexEvent("codex.connection.initialized", { result });
    await configurePlasticMcp();
    return result;
  };

  const ensureInitialized = async () => {
    if (!processHandle) {
      await connect();
    }
    if (!initialized) {
      await initialize();
    }
  };

  const status = () => ({
    connected: Boolean(processHandle),
    initialized,
    pid: processHandle?.pid ?? null,
    connectedAt,
    pendingRequests: pending.size,
    defaults: currentCodexDefaults,
    plasticMcp: {
      configured: plasticMcpConfigured,
      lastError: plasticMcpLastError,
      serverPath: plasticMcpServerPath,
      runtimeRpcUrl
    }
  });
  const registerMethods = async () => {
    await registerCodexCoreMethods({
      methods: input.methods,
      runPromise: input.runPromise,
      status,
      getCodexDefaults,
      appendCodexEvent,
      connect,
      initialize,
      ensureInitialized,
      request
    });

    await registerCodexBridgeMethods({
      methods: input.methods,
      runPromise: input.runPromise,
      workspaceDir,
      runtimeRpcUrl,
      getBridgeThreadId: () => bridgeMcpThreadId,
      setBridgeThreadId: (threadId) => {
        bridgeMcpThreadId = threadId;
      },
      getPlasticMcpState: () => ({
        configured: plasticMcpConfigured,
        lastError: plasticMcpLastError,
        serverPath: plasticMcpServerPath
      }),
      appendCodexEvent,
      configurePlasticMcp,
      ensureInitialized,
      request,
      asRecord,
      asString
    });

    await registerCodexAliasMethods({
      methods: input.methods,
      runPromise: input.runPromise,
      ensureInitialized,
      requestAlias
    });

    await registerCodexChatMethods({
      eventStore: input.eventStore,
      methods: input.methods,
      runPromise: input.runPromise,
      workspaceDir,
      getCodexDefaults,
      bindThreadToChat,
      getBoundThreadId,
      getChatBinding,
      startThreadForChat,
      threadStartPayload,
      developerInstructionsForChat,
      ensureInitialized,
      request,
      isThreadNotFoundError,
      asRecord,
      asString
    });
  };

  return {
    status,
    registerMethods
  };
};
