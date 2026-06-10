import { Effect } from "effect";
import { createEvent, type EventStore, type MethodRegistry } from "@plastic/core";
import { createCodexAppServerSession } from "./codex-app-server-session.js";
import { registerCodexChatMethods } from "./codex-chat-method-registration.js";
import { createCodexChatRuntime } from "./codex-chat-runtime.js";
import { createCodexMessageHandler } from "./codex-message-handler.js";
import { createCodexMcpConfig } from "./codex-mcp-config.js";
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
  let bridgeMcpThreadId: string | null = null;
  const pending = new Map<number, PendingRequest>();

  const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" ? value as Record<string, unknown> : {};

  const asString = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;

  const runtimeRpcUrl = input.runtimeRpcUrl ?? "http://127.0.0.1:7331/rpc";
  const runtimeRpcUrls = input.runtimeRpcUrls ?? [runtimeRpcUrl];
  const workspaceDir = input.workspaceDir ?? process.cwd();
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
    const chatId = threadId ? chatRuntime.chatIdForThread(threadId) : undefined;
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

  let request: (method: string, params?: unknown) => Promise<unknown>;

  const plasticMcp = createCodexMcpConfig({
    workspaceDir,
    runtimeRpcUrl,
    request: (method, params) => request(method, params),
    appendCodexEvent
  });

  const chatRuntime = createCodexChatRuntime({
    eventStore: input.eventStore,
    runPromise: input.runPromise,
    workspaceDir: input.workspaceDir,
    runtimeRpcUrl,
    runtimeRpcUrls,
    getCodexDefaults,
    request: (method, params) => request(method, params),
    asRecord,
    asString
  });

  const isThreadNotFoundError = (error: unknown) =>
    error instanceof Error && error.message.includes("thread not found");

  const handleMessage = createCodexMessageHandler({
    pending,
    methods: input.methods,
    runPromise: input.runPromise,
    appendCodexEvent,
    appendChatAgentEvent,
    respondToServerRequest: (id, result) => session.respondToServerRequest(id, result),
    rejectServerRequest: (id, error) => session.rejectServerRequest(id, error),
    asRecord,
    asString
  });

  const session = createCodexAppServerSession({
    runtimeRpcUrl,
    runtimeRpcUrls,
    pending,
    appendCodexEvent,
    handleMessage,
    configurePlasticMcp: plasticMcp.configure
  });
  request = session.request;
  const requestAlias = (method: string, methodInput: unknown) => request(method, methodInput);

  const status = () => ({
    ...session.status(),
    defaults: currentCodexDefaults,
    plasticMcp: {
      ...plasticMcp.state(),
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
      connect: session.connect,
      initialize: session.initialize,
      ensureInitialized: session.ensureInitialized,
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
      getPlasticMcpState: plasticMcp.state,
      appendCodexEvent,
      configurePlasticMcp: plasticMcp.configure,
      ensureInitialized: session.ensureInitialized,
      request,
      asRecord,
      asString
    });

    await registerCodexAliasMethods({
      methods: input.methods,
      runPromise: input.runPromise,
      ensureInitialized: session.ensureInitialized,
      requestAlias
    });

    await registerCodexChatMethods({
      eventStore: input.eventStore,
      methods: input.methods,
      runPromise: input.runPromise,
      workspaceDir,
      getCodexDefaults,
      bindThreadToChat: chatRuntime.bindThreadToChat,
      getBoundThreadId: chatRuntime.getBoundThreadId,
      getChatBinding: chatRuntime.getChatBinding,
      startThreadForChat: chatRuntime.startThreadForChat,
      threadStartPayload: chatRuntime.threadStartPayload,
      developerInstructionsForChat: chatRuntime.developerInstructionsForChat,
      ensureInitialized: session.ensureInitialized,
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
