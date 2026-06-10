import { Effect } from "effect";
import { type EventStore, type MethodRegistry, type PlasticEvent } from "@plastic/core";
import { registerCodexChatMethods } from "./codex-chat-method-registration.js";
import { type createCodexChatRuntime } from "./codex-chat-runtime.js";
import { type createCodexMcpConfig } from "./codex-mcp-config.js";
import {
  registerCodexAliasMethods,
  registerCodexBridgeMethods,
  registerCodexCoreMethods
} from "./codex-method-registration.js";

type RunPromise = <A>(effect: Effect.Effect<A, unknown>) => Promise<A>;
type CodexChatRuntime = ReturnType<typeof createCodexChatRuntime>;
type CodexMcpConfig = ReturnType<typeof createCodexMcpConfig>;

export const createCodexAdapterMethodRegistrar = (input: {
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
  workspaceDir: string;
  runtimeRpcUrl: string;
  status: () => unknown;
  getCodexDefaults: () => Promise<{ model: string }>;
  appendCodexEvent: (type: string, payload: unknown) => Promise<PlasticEvent>;
  connect: (codexPath?: string) => Promise<unknown>;
  initialize: () => Promise<unknown>;
  ensureInitialized: () => Promise<void>;
  request: (method: string, params?: unknown) => Promise<unknown>;
  requestAlias: (method: string, methodInput: unknown) => Promise<unknown>;
  plasticMcp: CodexMcpConfig;
  chatRuntime: CodexChatRuntime;
  isThreadNotFoundError: (error: unknown) => boolean;
  asRecord: (value: unknown) => Record<string, unknown>;
  asString: (value: unknown) => string | undefined;
}) => {
  let bridgeMcpThreadId: string | null = null;

  return async () => {
    await registerCodexCoreMethods({
      methods: input.methods,
      runPromise: input.runPromise,
      status: input.status,
      getCodexDefaults: input.getCodexDefaults,
      appendCodexEvent: input.appendCodexEvent,
      connect: input.connect,
      initialize: input.initialize,
      ensureInitialized: input.ensureInitialized,
      request: input.request
    });

    await registerCodexBridgeMethods({
      methods: input.methods,
      runPromise: input.runPromise,
      workspaceDir: input.workspaceDir,
      runtimeRpcUrl: input.runtimeRpcUrl,
      getBridgeThreadId: () => bridgeMcpThreadId,
      setBridgeThreadId: (threadId) => {
        bridgeMcpThreadId = threadId;
      },
      getPlasticMcpState: input.plasticMcp.state,
      appendCodexEvent: input.appendCodexEvent,
      configurePlasticMcp: input.plasticMcp.configure,
      ensureInitialized: input.ensureInitialized,
      request: input.request,
      asRecord: input.asRecord,
      asString: input.asString
    });

    await registerCodexAliasMethods({
      methods: input.methods,
      runPromise: input.runPromise,
      ensureInitialized: input.ensureInitialized,
      requestAlias: input.requestAlias
    });

    await registerCodexChatMethods({
      eventStore: input.eventStore,
      methods: input.methods,
      runPromise: input.runPromise,
      workspaceDir: input.workspaceDir,
      getCodexDefaults: input.getCodexDefaults,
      bindThreadToChat: input.chatRuntime.bindThreadToChat,
      getBoundThreadId: input.chatRuntime.getBoundThreadId,
      getChatBinding: input.chatRuntime.getChatBinding,
      startThreadForChat: input.chatRuntime.startThreadForChat,
      threadStartPayload: input.chatRuntime.threadStartPayload,
      developerInstructionsForChat: input.chatRuntime.developerInstructionsForChat,
      ensureInitialized: input.ensureInitialized,
      request: input.request,
      isThreadNotFoundError: input.isThreadNotFoundError,
      asRecord: input.asRecord,
      asString: input.asString
    });
  };
};
