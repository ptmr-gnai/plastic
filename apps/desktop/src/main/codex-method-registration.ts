import { Effect } from "effect";
import type { MethodRegistry } from "@plastic/core";
import type { RunPromise } from "./runtime-method-context.js";

export const codexBackendAvailability = {
  status: "available" as const,
  requiredCapabilities: ["agent.codex"]
};

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
      owner: { kind: "runtime", id: "plastic.codex-adapter" },
      availability: codexBackendAvailability,
      handler: () => Effect.sync(input.status)
    })
  );
};

const registerCodexDefaults = async (input: CodexCoreRegistrationInput) => {
  await input.runPromise(
    input.methods.register({
      id: "codex/defaults",
      title: "Get Codex defaults",
      description: "Returns Plastic's durable Codex adapter defaults used for new chat threads and turns.",
      owner: { kind: "runtime", id: "plastic.codex-adapter" },
      handler: () => Effect.promise(input.getCodexDefaults)
    })
  );
};

const registerCodexSetDefaults = async (input: CodexCoreRegistrationInput) => {
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
      owner: { kind: "runtime", id: "plastic.codex-adapter" },
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
      owner: { kind: "runtime", id: "plastic.codex-adapter" },
      handler: () => Effect.promise(input.initialize)
    })
  );
};

const registerCodexRequest = async (input: CodexCoreRegistrationInput) => {
  await input.runPromise(
    input.methods.register({
      id: "codex/request",
      title: "Raw Codex request",
      description: "Passthrough to any Codex app-server method. Params and result are preserved as-is.",
      owner: { kind: "runtime", id: "plastic.codex-adapter" },
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
      description: `Passthrough to Codex app-server ${definition.codexMethod}.`,
      owner: { kind: "runtime", id: "plastic.codex-adapter" },
      availability: codexBackendAvailability,
      handler: (methodInput) =>
        Effect.promise(async () => {
          await input.ensureInitialized();
          return input.requestAlias(definition.codexMethod, methodInput);
        })
    })
  );
};
