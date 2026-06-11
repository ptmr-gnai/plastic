import { Effect } from "effect";
import type { MethodRegistry } from "@plastic/core";
import type { RunPromise } from "./runtime-method-context.js";
import {
  bridgeCallPlasticRpcToolMetadata,
  bridgeConfigurePlasticMcpMetadata,
  bridgeStatusMetadata,
  bridgeTestMetadata,
  codexAliasMetadata,
  codexDefaultsMetadata,
  codexRequestMetadata,
  codexSetDefaultsMetadata,
  codexStatusMetadata
} from "./codex-backend-method-metadata.js";

export const codexBackendAvailability = {
  status: "available" as const,
  requiredCapabilities: ["agent.codex"]
};
export const codexBackendOwner = { kind: "runtime" as const, id: "plastic.agent-backend" };

type CodexAliasDefinition = {
  id: string;
  title: string;
  codexMethod: string;
};

type CodexCoreRegistrationInput = {
  methods: MethodRegistry;
  runPromise: RunPromise;
  status: () => unknown;
  getCodexDefaults: () => Promise<unknown>;
  appendCodexEvent: (type: string, payload: unknown) => Promise<{ id: string }>;
  connect: (codexPath?: string) => Promise<unknown>;
  initialize: () => Promise<unknown>;
  ensureInitialized: () => Promise<void>;
  request: (method: string, params?: unknown) => Promise<unknown>;
};

type CodexBridgeRegistrationInput = {
  methods: MethodRegistry;
  runPromise: RunPromise;
  workspaceDir: string;
  runtimeRpcUrl: string;
  getBridgeThreadId: () => string | null;
  setBridgeThreadId: (threadId: string) => void;
  getPlasticMcpState: () => {
    configured: boolean;
    lastError: string | null;
    serverPath: string;
  };
  appendCodexEvent: (type: string, payload: unknown) => Promise<{ id: string }>;
  configurePlasticMcp: () => Promise<unknown>;
  ensureInitialized: () => Promise<void>;
  request: (method: string, params?: unknown) => Promise<unknown>;
  asRecord: (value: unknown) => Record<string, unknown>;
  asString: (value: unknown) => string | undefined;
};

const codexAliasDefinitions: CodexAliasDefinition[] = [
  { id: "codex/threadStart", title: "Start Codex thread", codexMethod: "thread/start" },
  { id: "codex/threadResume", title: "Resume Codex thread", codexMethod: "thread/resume" },
  { id: "codex/threadFork", title: "Fork Codex thread", codexMethod: "thread/fork" },
  { id: "codex/threadList", title: "List Codex threads", codexMethod: "thread/list" },
  { id: "codex/threadRead", title: "Read Codex thread", codexMethod: "thread/read" },
  { id: "codex/threadArchive", title: "Archive Codex thread", codexMethod: "thread/archive" },
  { id: "codex/threadNameSet", title: "Set Codex thread name", codexMethod: "thread/name/set" },
  { id: "codex/turnStart", title: "Start Codex turn", codexMethod: "turn/start" },
  { id: "codex/turnSteer", title: "Steer active Codex turn", codexMethod: "turn/steer" },
  { id: "codex/turnInterrupt", title: "Interrupt Codex turn", codexMethod: "turn/interrupt" },
  { id: "codex/modelList", title: "List Codex models", codexMethod: "model/list" },
  { id: "codex/configRead", title: "Read Codex config", codexMethod: "config/read" }
];

export const registerCodexCoreMethods = async (input: CodexCoreRegistrationInput) => {
  await input.getCodexDefaults();
  await registerCodexStatus(input);
  await registerCodexDefaults(input);
  await registerCodexSetDefaults(input);
  await registerCodexConnect(input);
  await registerCodexInitialize(input);
  await registerCodexRequest(input);
};

const registerCodexStatus = async (input: CodexCoreRegistrationInput) => {
  await input.runPromise(
    input.methods.register({
      id: "codex/status",
      title: "Codex status",
      owner: codexBackendOwner,
      availability: codexBackendAvailability,
      ...codexStatusMetadata,
      handler: () => Effect.sync(input.status)
    })
  );
};

const registerCodexDefaults = async (input: CodexCoreRegistrationInput) => {
  await input.runPromise(
    input.methods.register({
      id: "codex/defaults",
      title: "Get Codex defaults",
      owner: codexBackendOwner,
      availability: codexBackendAvailability,
      ...codexDefaultsMetadata,
      handler: () => Effect.promise(input.getCodexDefaults)
    })
  );
};

const registerCodexSetDefaults = async (input: CodexCoreRegistrationInput) => {
  await input.runPromise(
    input.methods.register({
      id: "codex/setDefaults",
      title: "Set Codex defaults",
      owner: codexBackendOwner,
      availability: codexBackendAvailability,
      ...codexSetDefaultsMetadata,
      handler: (methodInput) =>
        Effect.promise(async () => {
          const payload = methodInput as { model?: string };
          const model = payload.model?.trim();
          if (!model) {
            throw new Error("codex/setDefaults requires model");
          }
          const event = await input.appendCodexEvent("codex.defaults.updated", { model });
          return {
            defaults: await input.getCodexDefaults(),
            eventId: event.id
          };
        })
    })
  );
};

const registerCodexConnect = async (input: CodexCoreRegistrationInput) => {
  await input.runPromise(
    input.methods.register({
      id: "codex/connect",
      title: "Connect Codex app-server",
      description: "Connects to the Codex app-server process.",
      owner: codexBackendOwner,
      availability: codexBackendAvailability,
      handler: (methodInput) =>
        Effect.promise(async () => {
          const codexPath = (methodInput as { codexPath?: string } | undefined)?.codexPath;
          return input.connect(codexPath);
        })
    })
  );
};

const registerCodexInitialize = async (input: CodexCoreRegistrationInput) => {
  await input.runPromise(
    input.methods.register({
      id: "codex/initialize",
      title: "Initialize Codex app-server",
      description: "Initializes the Codex app-server session.",
      owner: codexBackendOwner,
      availability: codexBackendAvailability,
      handler: () => Effect.promise(input.initialize)
    })
  );
};

const registerCodexRequest = async (input: CodexCoreRegistrationInput) => {
  await input.runPromise(
    input.methods.register({
      id: "codex/request",
      title: "Raw Codex request",
      owner: codexBackendOwner,
      availability: codexBackendAvailability,
      ...codexRequestMetadata,
      handler: (methodInput) =>
        Effect.promise(async () => {
          await input.ensureInitialized();
          const payload = methodInput as { method?: string; params?: unknown };
          if (!payload.method) {
            throw new Error("codex/request requires method");
          }
          return input.request(payload.method, payload.params);
        })
    })
  );
};

export const registerCodexBridgeMethods = async (input: CodexBridgeRegistrationInput) => {
  await registerConfigurePlasticMcp(input);
  await registerBridgeStatus(input);
  await registerBridgeTest(input);
  await registerCallPlasticRpcTool(input);
};

const registerConfigurePlasticMcp = async (input: CodexBridgeRegistrationInput) => {
  await input.runPromise(
    input.methods.register({
      id: "bridge/configurePlasticMcp",
      title: "Configure Plastic MCP bridge",
      owner: codexBackendOwner,
      availability: codexBackendAvailability,
      ...bridgeConfigurePlasticMcpMetadata,
      handler: () =>
        Effect.promise(async () => {
          await input.ensureInitialized();
          return input.configurePlasticMcp();
        })
    })
  );
};

const registerBridgeStatus = async (input: CodexBridgeRegistrationInput) => {
  await input.runPromise(
    input.methods.register({
      id: "bridge/status",
      title: "Plastic bridge status",
      owner: codexBackendOwner,
      availability: codexBackendAvailability,
      ...bridgeStatusMetadata,
      handler: () =>
        Effect.promise(async () => {
          await input.ensureInitialized();
          let mcpStatus: unknown = null;
          let mcpError: string | null = null;
          try {
            mcpStatus = await input.request("mcpServerStatus/list", {
              detail: "full",
              limit: 50
            });
          } catch (error) {
            mcpError = error instanceof Error ? error.message : String(error);
          }
          const mcp = input.getPlasticMcpState();
          return {
            plasticMcpConfigured: mcp.configured,
            plasticMcpLastError: mcp.lastError,
            plasticMcpServerPath: mcp.serverPath,
            runtimeRpcUrl: input.runtimeRpcUrl,
            mcpStatus,
            mcpError
          };
        })
    })
  );
};

const registerBridgeTest = async (input: CodexBridgeRegistrationInput) => {
  await input.runPromise(
    input.methods.register({
      id: "bridge/test",
      title: "Test Plastic MCP bridge",
      owner: codexBackendOwner,
      availability: codexBackendAvailability,
      ...bridgeTestMetadata,
      handler: () =>
        Effect.promise(async () => {
          await input.ensureInitialized();
          const status = await input.request("mcpServerStatus/list", {
            detail: "full",
            limit: 50
          });
          const text = JSON.stringify(status);
          const ok = text.includes("plastic") && text.includes("plastic_rpc");
          const event = await input.appendCodexEvent("bridge.plastic_mcp.tested", {
            ok,
            status
          });
          return { ok, status, eventId: event.id };
        })
    })
  );
};

const registerCallPlasticRpcTool = async (input: CodexBridgeRegistrationInput) => {
  await input.runPromise(
    input.methods.register({
      id: "bridge/callPlasticRpcTool",
      title: "Call Plastic RPC through MCP",
      owner: codexBackendOwner,
      availability: codexBackendAvailability,
      ...bridgeCallPlasticRpcToolMetadata,
      handler: (methodInput) =>
        Effect.promise(async () => {
          await input.ensureInitialized();
          await input.configurePlasticMcp();
          const payload = methodInput as {
            threadId?: string;
            method?: string;
            input?: Record<string, unknown>;
          };
          if (!payload.method) {
            throw new Error("bridge/callPlasticRpcTool requires method");
          }
          const threadId = await getOrStartBridgeThread(input, payload.threadId);
          const result = await input.request("mcpServer/tool/call", {
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
          const event = await input.appendCodexEvent("bridge.plastic_rpc_tool.called", {
            threadId,
            method: payload.method,
            input: payload.input ?? {},
            result
          });
          return { threadId, result, eventId: event.id };
        })
    })
  );
};

const getOrStartBridgeThread = async (input: CodexBridgeRegistrationInput, requestedThreadId: string | undefined) => {
  const existingThreadId = requestedThreadId ?? input.getBridgeThreadId();
  if (existingThreadId) {
    return existingThreadId;
  }
  const threadResult = await input.request("thread/start", {
    cwd: input.workspaceDir,
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    personality: "friendly",
    serviceName: "plastic",
    developerInstructions:
      "You are a Plastic bridge validation thread. Use the plastic_rpc MCP tool when asked to observe or control Plastic."
  });
  const thread = input.asRecord(input.asRecord(threadResult).thread);
  const threadId = input.asString(thread.id);
  if (!threadId) {
    throw new Error("Codex thread/start did not return thread.id");
  }
  input.setBridgeThreadId(threadId);
  await input.appendCodexEvent("bridge.plastic_mcp.thread_started", {
    threadId,
    thread: input.asRecord(threadResult).thread ?? threadResult
  });
  return threadId;
};

export const registerCodexAliasMethods = async (input: {
  methods: MethodRegistry;
  runPromise: RunPromise;
  ensureInitialized: () => Promise<void>;
  requestAlias: (codexMethod: string, methodInput: unknown) => Promise<unknown>;
}) => {
  for (const definition of codexAliasDefinitions) {
    await registerCodexAliasMethod(input, definition);
  }
};

const registerCodexAliasMethod = async (
  input: {
    methods: MethodRegistry;
    runPromise: RunPromise;
    ensureInitialized: () => Promise<void>;
    requestAlias: (codexMethod: string, methodInput: unknown) => Promise<unknown>;
  },
  definition: CodexAliasDefinition
) => {
  await input.runPromise(
    input.methods.register({
      id: definition.id,
      title: definition.title,
      owner: codexBackendOwner,
      availability: codexBackendAvailability,
      ...codexAliasMetadata(definition.codexMethod),
      handler: (methodInput) =>
        Effect.promise(async () => {
          await input.ensureInitialized();
          return input.requestAlias(definition.codexMethod, methodInput);
        })
    })
  );
};
