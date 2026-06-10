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
