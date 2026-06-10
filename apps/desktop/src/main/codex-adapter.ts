import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Effect } from "effect";
import { createEvent, projectPanels, type EventStore, type MethodRegistry } from "@plastic/core";
import {
  codexBackendAvailability,
  registerCodexAliasMethods
} from "./codex-method-registration.js";

interface CodexRpcMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

interface PendingRequest {
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

  const mapNotificationToChat = (method: string, params: unknown) => {
    const payload = asRecord(params);
    if (method === "item/agentMessage/delta") {
      appendChatAgentEvent("chat.agent_message.delta", {
        threadId: payload.threadId,
        turnId: payload.turnId,
        itemId: payload.itemId,
        delta: payload.delta
      });
      return;
    }

    if (method === "item/completed") {
      const item = asRecord(payload.item);
      if (item.type === "agentMessage") {
        appendChatAgentEvent("chat.agent_message.completed", {
          threadId: payload.threadId,
          turnId: payload.turnId,
          itemId: item.id ?? payload.itemId,
          content: item.text
        });
      }
      return;
    }

    if (method === "turn/completed") {
      const turn = asRecord(payload.turn);
      appendChatAgentEvent("chat.codex_turn.completed", {
        threadId: turn.threadId ?? payload.threadId,
        turnId: turn.id ?? payload.turnId,
        status: turn.status,
        error: turn.error
      });
    }
  };

  const notificationEventType = (method: string) => {
    const known: Record<string, string> = {
      "thread/started": "codex.thread.started",
      "thread/status/changed": "codex.thread.status_changed",
      "thread/archived": "codex.thread.archived",
      "thread/unarchived": "codex.thread.unarchived",
      "thread/closed": "codex.thread.closed",
      "thread/name/updated": "codex.thread.name_updated",
      "thread/tokenUsage/updated": "codex.thread.token_usage_updated",
      "turn/started": "codex.turn.started",
      "turn/completed": "codex.turn.completed",
      "turn/diff/updated": "codex.turn.diff_updated",
      "turn/plan/updated": "codex.turn.plan_updated",
      "item/started": "codex.item.started",
      "item/completed": "codex.item.completed",
      "item/agentMessage/delta": "codex.item.agent_message_delta",
      "item/commandExecution/outputDelta": "codex.item.command_output_delta",
      "item/reasoning/summaryTextDelta": "codex.item.reasoning_summary_delta",
      "serverRequest/resolved": "codex.server_request.resolved"
    };
    return known[method] ?? `codex.${method.replaceAll("/", ".")}`;
  };

  const handleMessage = (message: CodexRpcMessage) => {
    if (typeof message.id === "number" && pending.has(message.id)) {
      const requestState = pending.get(message.id);
      pending.delete(message.id);
      if (!requestState) {
        return;
      }
      if (message.error) {
        void appendCodexEvent("codex.request.failed", {
          id: message.id,
          method: requestState.method,
          params: requestState.params,
          error: message.error,
          sentEventId: requestState.sentEventId
        });
        requestState.reject(new Error(JSON.stringify(message.error)));
      } else {
        void appendCodexEvent("codex.response.received", {
          id: message.id,
          method: requestState.method,
          result: message.result,
          sentEventId: requestState.sentEventId
        });
        requestState.resolve(message.result);
      }
      return;
    }

    if (typeof message.id === "number" && message.method) {
      void appendCodexEvent("codex.server_request.received", {
        id: message.id,
        method: message.method,
        params: message.params
      });
      if (message.method === "item/tool/call") {
        const requestId = message.id;
        void (async () => {
          try {
            const params = asRecord(message.params);
            const namespace = asString(params.namespace);
            const tool = asString(params.tool);
            if (!((namespace === undefined && tool === "plastic_rpc") || (namespace === "plastic" && tool === "rpc"))) {
              throw new Error(`Unsupported dynamic tool: ${namespace ? `${namespace}.` : ""}${tool ?? "unknown"}`);
            }

            const args = asRecord(params.arguments);
            const method = asString(args.method);
            if (!method) {
              throw new Error("plastic_rpc requires arguments.method");
            }

            const value = await input.runPromise(input.methods.call(method, args.input));
            const result = {
              contentItems: [
                {
                  type: "inputText",
                  text: JSON.stringify({ ok: true, value })
                }
              ],
              success: true
            };
            await appendCodexEvent("codex.server_request.responded", {
              id: requestId,
              method: message.method,
              tool: `${namespace}.${tool}`,
              rpcMethod: method,
              result
            });
            respondToServerRequest(requestId, result);
          } catch (error) {
            const result = {
              contentItems: [
                {
                  type: "inputText",
                  text: JSON.stringify({
                    ok: false,
                    error: error instanceof Error ? error.message : String(error)
                  })
                }
              ],
              success: false
            };
            await appendCodexEvent("codex.server_request.responded", {
              id: requestId,
              method: message.method,
              result
            });
            respondToServerRequest(requestId, result);
          }
        })();
        return;
      }
      rejectServerRequest(message.id, new Error(`Unsupported server request: ${message.method}`));
      return;
    }

    if (message.method) {
      void appendCodexEvent("codex.notification.received", {
        method: message.method,
        params: message.params
      });
      void appendCodexEvent(notificationEventType(message.method), message.params ?? {});
      mapNotificationToChat(message.method, message.params);
    }
  };

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
    await getCodexDefaults();

    await input.runPromise(
      input.methods.register({
        id: "codex/status",
        title: "Codex status",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        availability: codexBackendAvailability,
        handler: () => Effect.sync(status)
      })
    );

    await input.runPromise(
      input.methods.register({
        id: "codex/defaults",
        title: "Get Codex defaults",
        description: "Returns Plastic's durable Codex adapter defaults used for new chat threads and turns.",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        handler: () => Effect.promise(getCodexDefaults)
      })
    );

    await input.runPromise(
      input.methods.register({
        id: "codex/setDefaults",
        title: "Set Codex defaults",
        description: "Durably updates Plastic's Codex adapter defaults.",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        handler: (methodInput) =>
          Effect.promise(async () => {
            const payload = methodInput as { model?: string };
            const model = payload.model?.trim();
            if (!model) {
              throw new Error("codex/setDefaults requires model");
            }
            const event = await appendCodexEvent("codex.defaults.updated", { model });
            return {
              defaults: await getCodexDefaults(),
              eventId: event.id
            };
          })
      })
    );

    await input.runPromise(
      input.methods.register({
        id: "codex/connect",
        title: "Connect Codex app-server",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        handler: (methodInput) =>
          Effect.promise(async () => {
            const codexPath = (methodInput as { codexPath?: string } | undefined)?.codexPath;
            return connect(codexPath);
          })
      })
    );

    await input.runPromise(
      input.methods.register({
        id: "codex/initialize",
        title: "Initialize Codex app-server",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        handler: () => Effect.promise(initialize)
      })
    );

    await input.runPromise(
      input.methods.register({
        id: "codex/request",
        title: "Raw Codex request",
        description: "Passthrough to any Codex app-server method. Params and result are preserved as-is.",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        handler: (methodInput) =>
          Effect.promise(async () => {
            await ensureInitialized();
            const payload = methodInput as { method?: string; params?: unknown };
            if (!payload.method) {
              throw new Error("codex/request requires method");
            }
            return request(payload.method, payload.params);
          })
      })
    );

    await input.runPromise(
      input.methods.register({
        id: "bridge/configurePlasticMcp",
        title: "Configure Plastic MCP bridge",
        description: "Registers the plastic_rpc MCP tool with Codex app-server and reloads MCP config.",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        handler: () =>
          Effect.promise(async () => {
            await ensureInitialized();
            return configurePlasticMcp();
          })
      })
    );

    await input.runPromise(
      input.methods.register({
        id: "bridge/status",
        title: "Plastic bridge status",
        description: "Returns Codex MCP bridge configuration and discovered MCP tool status.",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        handler: () =>
          Effect.promise(async () => {
            await ensureInitialized();
            let mcpStatus: unknown = null;
            let mcpError: string | null = null;
            try {
              mcpStatus = await request("mcpServerStatus/list", {
                detail: "full",
                limit: 50
              });
            } catch (error) {
              mcpError = error instanceof Error ? error.message : String(error);
            }
            return {
              plasticMcpConfigured,
              plasticMcpLastError,
              plasticMcpServerPath,
              runtimeRpcUrl,
              mcpStatus,
              mcpError
            };
          })
      })
    );

    await input.runPromise(
      input.methods.register({
        id: "bridge/test",
        title: "Test Plastic MCP bridge",
        description: "Checks that Codex sees the plastic MCP server and plastic_rpc tool.",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        handler: () =>
          Effect.promise(async () => {
            await ensureInitialized();
            const status = await request("mcpServerStatus/list", {
              detail: "full",
              limit: 50
            });
            const text = JSON.stringify(status);
            const ok = text.includes("plastic") && text.includes("plastic_rpc");
            const event = await appendCodexEvent("bridge.plastic_mcp.tested", {
              ok,
              status
            });
            return { ok, status, eventId: event.id };
          })
      })
    );

    await input.runPromise(
      input.methods.register({
        id: "bridge/callPlasticRpcTool",
        title: "Call Plastic RPC through MCP",
        description: "Calls the plastic_rpc MCP tool through Codex app-server to prove the agent tool path works.",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        handler: (methodInput) =>
          Effect.promise(async () => {
            await ensureInitialized();
            await configurePlasticMcp();
            const payload = methodInput as {
              threadId?: string;
              method?: string;
              input?: Record<string, unknown>;
            };
            if (!payload.method) {
              throw new Error("bridge/callPlasticRpcTool requires method");
            }
            if (!payload.threadId && !bridgeMcpThreadId) {
              const threadResult = await request("thread/start", {
                cwd: input.workspaceDir,
                approvalPolicy: "never",
                sandbox: "danger-full-access",
                personality: "friendly",
                serviceName: "plastic",
                developerInstructions:
                  "You are a Plastic bridge validation thread. Use the plastic_rpc MCP tool when asked to observe or control Plastic."
              });
              const thread = asRecord(asRecord(threadResult).thread);
              const threadId = asString(thread.id);
              if (!threadId) {
                throw new Error("Codex thread/start did not return thread.id");
              }
              bridgeMcpThreadId = threadId;
              await appendCodexEvent("bridge.plastic_mcp.thread_started", {
                threadId,
                thread: asRecord(threadResult).thread ?? threadResult
              });
            }

            const threadId = payload.threadId ?? bridgeMcpThreadId;
            if (!threadId) {
              throw new Error("bridge/callPlasticRpcTool requires threadId");
            }
            const result = await request("mcpServer/tool/call", {
              threadId,
              server: "plastic",
              tool: "plastic_rpc",
              arguments: {
                method: payload.method,
                input: payload.input ?? {}
              },
              meta: {
                source: "plastic.bridge"
              }
            });
            const event = await appendCodexEvent("bridge.plastic_rpc_tool.called", {
              threadId,
              method: payload.method,
              input: payload.input ?? {},
              result
            });
            return { threadId, result, eventId: event.id };
          })
      })
    );

    await registerCodexAliasMethods({
      methods: input.methods,
      runPromise: input.runPromise,
      ensureInitialized,
      requestAlias
    });

    await input.runPromise(
      input.methods.register({
        id: "chats/getBinding",
        title: "Get chat backend binding",
        description: "Returns the current Codex thread binding and active turn state for a chat panel.",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        availability: codexBackendAvailability,
        handler: (methodInput) =>
          Effect.promise(async () => {
            const chatId = (methodInput as { chatId?: string } | undefined)?.chatId ?? "chat-main";
            return getChatBinding(chatId);
          })
      })
    );

    await input.runPromise(
      input.methods.register({
        id: "chats/bindCodexThread",
        title: "Bind chat to Codex thread",
        description: "Durably binds a chat panel to an existing Codex thread id.",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        handler: (methodInput) =>
          Effect.promise(async () => {
            const payload = methodInput as { chatId?: string; threadId?: string; reason?: string };
            const chatId = payload.chatId ?? "chat-main";
            if (!payload.threadId) {
              throw new Error("chats/bindCodexThread requires threadId");
            }
            await bindThreadToChat(chatId, payload.threadId, payload.reason ?? "manual bind");
            return getChatBinding(chatId);
          })
      })
    );

    await input.runPromise(
      input.methods.register({
        id: "chats/startCodexThread",
        title: "Start chat Codex thread",
        description: "Starts a Codex thread through native thread/start and binds it to a chat panel.",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        handler: (methodInput) =>
          Effect.promise(async () => {
            await ensureInitialized();
            const payload = methodInput as { chatId?: string; cwd?: string; params?: Record<string, unknown> };
            const chatId = payload.chatId ?? "chat-main";
            const defaults = await getCodexDefaults();
            const threadResult = await request("thread/start", {
              cwd: payload.cwd ?? input.workspaceDir,
              approvalPolicy: "never",
              sandbox: "danger-full-access",
              model: defaults.model,
              personality: "friendly",
              serviceName: "plastic",
              developerInstructions: developerInstructionsForChat(chatId),
              ...payload.params
            });
            const thread = asRecord(asRecord(threadResult).thread);
            const threadId = asString(thread.id);
            if (!threadId) {
              throw new Error("Codex thread/start did not return thread.id");
            }
            await bindThreadToChat(chatId, threadId, "chats/startCodexThread");
            return {
              chatId,
              threadId,
              thread: asRecord(threadResult).thread ?? threadResult
            };
          })
      })
    );

    await input.runPromise(
      input.methods.register({
        id: "chats/createCodexChat",
        title: "Create Codex chat",
        description: "Creates a new chat panel, starts a fresh Codex thread, and binds them.",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        availability: codexBackendAvailability,
        handler: (methodInput) =>
          Effect.promise(async () => {
            await ensureInitialized();
            const payload = methodInput as {
              id?: string;
              title?: string;
              cwd?: string;
              order?: number;
              params?: Record<string, unknown>;
            };
            const events = await input.runPromise(input.eventStore.list());
            const panels = projectPanels(events);
            const chatCount = panels.filter((panel) => panel.kind === "chat").length;
            const panelId = payload.id ?? `chat-${crypto.randomUUID().slice(0, 8)}`;
            const title = payload.title ?? `Chat ${chatCount + 1}`;
            const order = payload.order ?? Math.max(0, ...panels.map((panel) => panel.order)) + 1;
            const defaults = await getCodexDefaults();
            const threadResult = await request("thread/start", {
              cwd: payload.cwd ?? input.workspaceDir,
              approvalPolicy: "never",
              sandbox: "danger-full-access",
              model: defaults.model,
              personality: "friendly",
              serviceName: "plastic",
              developerInstructions: developerInstructionsForChat(panelId),
              ...payload.params
            });
            const thread = asRecord(asRecord(threadResult).thread);
            const threadId = asString(thread.id);
            if (!threadId) {
              throw new Error("Codex thread/start did not return thread.id");
            }

            const panelEvent = await input.runPromise(
              input.eventStore.append(
                createEvent({
                  type: "panel.created",
                  payload: {
                    id: panelId,
                    title,
                    kind: "chat",
                    extensionId: "plastic.chat",
                    rendererId: "plastic.chat.chat-panel",
                    subtitle: "Markdown conversation surface",
                    body: "Fresh Codex chat created through chats/createCodexChat.",
                    order
                  },
                  scope: {
                    panelId,
                    extensionId: "plastic.chat"
                  }
                })
              )
            );
            await bindThreadToChat(panelId, threadId, "chats/createCodexChat");
            return {
              panelId,
              chatId: panelId,
              threadId,
              panelEvent,
              thread: asRecord(threadResult).thread ?? threadResult
            };
          })
      })
    );

    await input.runPromise(
      input.methods.register({
        id: "chats/interrupt",
        title: "Interrupt chat turn",
        description: "Interrupts the active Codex turn bound to a chat panel.",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        handler: (methodInput) =>
          Effect.promise(async () => {
            await ensureInitialized();
            const payload = methodInput as { chatId?: string; turnId?: string };
            const binding = await getChatBinding(payload.chatId ?? "chat-main");
            const turnId = payload.turnId ?? binding.activeTurnId;
            if (!binding.threadId || !turnId || binding.activeTurnStatus !== "inProgress") {
              throw new Error("chats/interrupt requires a bound thread with an active in-progress turn");
            }
            const result = await request("turn/interrupt", {
              threadId: binding.threadId,
              turnId
            });
            await input.runPromise(
              input.eventStore.append(
                createEvent({
                  type: "chat.turn.interrupted",
                  payload: {
                    chatId: binding.chatId,
                    threadId: binding.threadId,
                    turnId,
                    result
                  },
                  scope: {
                    panelId: binding.chatId,
                    agentId: "codex"
                  }
                })
              )
            );
            return result;
          })
      })
    );

    await input.runPromise(
      input.methods.register({
        id: "chats/close",
        title: "Close chat",
        description: "Closes a chat panel and interrupts any in-progress Codex turn before removing it.",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        handler: (methodInput) =>
          Effect.promise(async () => {
            const payload = methodInput as { chatId?: string; reason?: string };
            const chatId = payload.chatId ?? "chat-main";
            const binding = await getChatBinding(chatId);
            let interruptResult: unknown = null;
            if (binding.threadId && binding.activeTurnId && binding.activeTurnStatus === "inProgress") {
              await ensureInitialized();
              interruptResult = await request("turn/interrupt", {
                threadId: binding.threadId,
                turnId: binding.activeTurnId
              });
            }

            const closedEvent = await input.runPromise(
              input.eventStore.append(
                createEvent({
                  type: "chat.session.closed",
                  payload: {
                    chatId,
                    threadId: binding.threadId,
                    activeTurnId: binding.activeTurnId,
                    activeTurnStatus: binding.activeTurnStatus,
                    interrupted: Boolean(interruptResult),
                    reason: payload.reason ?? "closed"
                  },
                  scope: {
                    panelId: chatId,
                    agentId: "codex"
                  }
                })
              )
            );

            const panelEvent = await input.runPromise(
              input.eventStore.append(
                createEvent({
                  type: "panel.removed",
                  payload: {
                    id: chatId,
                    reason: payload.reason ?? "chat closed"
                  },
                  scope: { panelId: chatId }
                })
              )
            );

            return {
              chatId,
              binding,
              interrupted: Boolean(interruptResult),
              interruptResult,
              closedEvent,
              panelEvent
            };
          })
      })
    );

    await input.runPromise(
      input.methods.register({
        id: "chats/sendToCodex",
        title: "Send chat message to Codex",
        description: "Durably records a user message, binds the chat to a Codex thread, and starts a Codex turn.",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        availability: codexBackendAvailability,
        handler: (methodInput) =>
          Effect.promise(async () => {
            await ensureInitialized();
            const payload = methodInput as {
              chatId?: string;
              content?: string;
              cwd?: string;
              model?: string;
              effort?: string;
            };
            const chatId = payload.chatId ?? "chat-main";
            const content = payload.content?.trim();
            if (!content) {
              throw new Error("chats/sendToCodex requires content");
            }

            const userMessage = await input.runPromise(
              input.eventStore.append(
                createEvent({
                  type: "chat.user_message.submitted",
                  payload: {
                    chatId,
                    content,
                    targetAgent: "codex"
                  },
                  scope: {
                    panelId: chatId,
                    agentId: "codex"
                  },
                  actor: {
                    kind: "user",
                    id: "local-user",
                    name: "Local User"
                  }
                })
              )
            );

            let threadId = await getBoundThreadId(chatId);
            let threadResult: unknown = null;
            if (!threadId) {
              const started = await startThreadForChat(chatId, threadStartPayload("chats/sendToCodex", payload.cwd));
              threadId = started.threadId;
              threadResult = started.threadResult;
            }
            const defaults = await getCodexDefaults();

            const turnInput = {
              threadId,
              input: [{ type: "text", text: content }],
              model: payload.model ?? defaults.model,
              ...(payload.effort ? { effort: payload.effort } : {})
            };

            let turnResult: unknown;
            try {
              turnResult = await request("turn/start", turnInput);
            } catch (error) {
              if (!isThreadNotFoundError(error)) {
                throw error;
              }
              const staleThreadId = threadId;
              await input.runPromise(
                input.eventStore.append(
                  createEvent({
                    type: "chat.codex_thread.stale",
                    payload: {
                      chatId,
                      threadId: staleThreadId,
                      error: error instanceof Error ? error.message : String(error)
                    },
                    scope: {
                      panelId: chatId,
                      agentId: "codex"
                    }
                  })
                )
              );
              const started = await startThreadForChat(chatId, threadStartPayload("stale thread rebind", payload.cwd));
              threadId = started.threadId;
              threadResult = started.threadResult;
              turnResult = await request("turn/start", {
                ...turnInput,
                threadId
              });
            }

            await input.runPromise(
              input.eventStore.append(
                createEvent({
                  type: "chat.codex_turn.started",
                  payload: {
                    chatId,
                    threadId,
                    userMessageId: userMessage.id,
                    turn: asRecord(turnResult).turn ?? turnResult,
                    thread: threadResult ? asRecord(threadResult).thread ?? threadResult : null
                  },
                  scope: {
                    panelId: chatId,
                    agentId: "codex"
                  }
                })
              )
            );

            return {
              chatId,
              threadId,
              userMessage,
              turn: asRecord(turnResult).turn ?? turnResult
            };
          })
      })
    );
  };

  return {
    status,
    registerMethods
  };
};
