import { Effect } from "effect";
import { createEvent, type EventStore, type MethodRegistry } from "@plastic/core";
import { createCodexAdapterMethodRegistrar } from "./codex-adapter-methods.js";
import { createCodexAppServerSession } from "./codex-app-server-session.js";
import { createCodexChatRuntime } from "./codex-chat-runtime.js";
import { createCodexDefaultsReader } from "./codex-defaults.js";
import { createCodexMessageHandler } from "./codex-message-handler.js";
import { createCodexMcpConfig } from "./codex-mcp-config.js";

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

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const isThreadNotFoundError = (error: unknown) =>
  error instanceof Error && error.message.includes("thread not found");

export const createCodexAdapter = (input: {
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: <A>(effect: Effect.Effect<A, unknown>) => Promise<A>;
  workspaceDir?: string;
  runtimeRpcUrl?: string;
  runtimeRpcUrls?: string[];
}): CodexAdapter => {
  const pending = new Map<number, PendingRequest>();

  const runtimeRpcUrl = input.runtimeRpcUrl ?? "http://127.0.0.1:7331/rpc";
  const runtimeRpcUrls = input.runtimeRpcUrls ?? [runtimeRpcUrl];
  const workspaceDir = input.workspaceDir ?? process.cwd();
  const fallbackCodexModel = process.env.PLASTIC_CODEX_MODEL ?? "gpt-5.4-mini";

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

  const codexDefaults = createCodexDefaultsReader({
    eventStore: input.eventStore,
    runPromise: input.runPromise,
    fallbackModel: fallbackCodexModel,
    asRecord,
    asString
  });

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
    getCodexDefaults: codexDefaults.getCodexDefaults,
    request: (method, params) => request(method, params),
    asRecord,
    asString
  });

  const handleMessage = createCodexMessageHandler({
    pending,
    methods: input.methods,
    runPromise: input.runPromise,
    appendCodexEvent,
    appendChatAgentEvent: chatRuntime.appendChatAgentEvent,
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
    defaults: codexDefaults.current(),
    plasticMcp: {
      ...plasticMcp.state(),
      runtimeRpcUrl
    }
  });
  const registerMethods = createCodexAdapterMethodRegistrar({
    eventStore: input.eventStore,
    methods: input.methods,
    runPromise: input.runPromise,
    workspaceDir,
    runtimeRpcUrl,
    status,
    getCodexDefaults: codexDefaults.getCodexDefaults,
    appendCodexEvent,
    connect: session.connect,
    initialize: session.initialize,
    ensureInitialized: session.ensureInitialized,
    request,
    requestAlias,
    plasticMcp,
    chatRuntime,
    isThreadNotFoundError,
    asRecord,
    asString
  });

  return {
    status,
    registerMethods
  };
};
