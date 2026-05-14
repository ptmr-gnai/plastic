import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { Effect } from "effect";
import { createEvent, type EventStore, type MethodRegistry } from "@plastic/core";

interface CodexRpcMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

interface PendingRequest {
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
}): CodexAdapter => {
  let processHandle: ChildProcessWithoutNullStreams | null = null;
  let nextId = 1;
  let initialized = false;
  let connectedAt: string | null = null;
  const pending = new Map<number, PendingRequest>();
  const threadChatBindings = new Map<string, string>();

  const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" ? value as Record<string, unknown> : {};

  const asString = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;

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

  const request = (method: string, params?: unknown): Promise<unknown> => {
    const id = nextId;
    nextId += 1;
    send({ id, method, params });
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  };

  const notify = (method: string, params?: unknown) => {
    send({ method, params });
  };

  const bindThreadToChat = async (chatId: string, threadId: string, reason: string) => {
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

  const startThreadForChat = async (chatId: string, payload: {
    cwd?: string;
    reason: string;
  }) => {
    const threadResult = await request("thread/start", {
      cwd: payload.cwd ?? input.workspaceDir,
      approvalPolicy: "never",
      sandbox: "workspace-write",
      personality: "friendly",
      serviceName: "plastic"
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

  const handleMessage = (message: CodexRpcMessage) => {
    if (typeof message.id === "number" && pending.has(message.id)) {
      const requestState = pending.get(message.id);
      pending.delete(message.id);
      if (!requestState) {
        return;
      }
      if (message.error) {
        requestState.reject(new Error(JSON.stringify(message.error)));
      } else {
        requestState.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      void appendCodexEvent(`codex.${message.method.replaceAll("/", ".")}`, {
        method: message.method,
        params: message.params
      });
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
      env: process.env
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
    pendingRequests: pending.size
  });

  const registerMethods = async () => {
    await input.runPromise(
      input.methods.register({
        id: "codex/status",
        title: "Codex status",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        handler: () => Effect.sync(status)
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
        id: "codex/threadStart",
        title: "Start Codex thread",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        handler: (methodInput) =>
          Effect.promise(async () => {
            await ensureInitialized();
            return request("thread/start", methodInput);
          })
      })
    );

    await input.runPromise(
      input.methods.register({
        id: "codex/turnStart",
        title: "Start Codex turn",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        handler: (methodInput) =>
          Effect.promise(async () => {
            await ensureInitialized();
            return request("turn/start", methodInput);
          })
      })
    );

    await input.runPromise(
      input.methods.register({
        id: "chats/sendToCodex",
        title: "Send chat message to Codex",
        description: "Durably records a user message, binds the chat to a Codex thread, and starts a Codex turn.",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
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

            const turnInput = {
              threadId,
              input: [{ type: "text", text: content }],
              ...(payload.model ? { model: payload.model } : {}),
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
