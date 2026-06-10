import type { EventStore, MethodRegistry } from "@plastic/core";
import { registerAndActivateExtensionsAtStartup } from "./extension-startup.js";
import { panelMailboxModule } from "./panel-methods.js";
import type { PlasticRuntime } from "./runtime-kernel.js";
import {
  registerRuntimeModulePlan,
  type RuntimeModulePlanInput
} from "./runtime-module-plan.js";
import type { RuntimeModule, RunPromise } from "./runtime-method-context.js";

type CoreRuntimeStartupInput = RuntimeModulePlanInput & {
  workspaceDir: string;
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
  runtime: Pick<PlasticRuntime, "registerModules">;
  onRegister?: (module: RuntimeModule) => void;
  onPhase?: (phase: string) => void;
};

export const registerCoreRuntimeModulesAtStartup = async (input: CoreRuntimeStartupInput) => {
  const {
    workspaceDir,
    eventStore,
    methods,
    runPromise,
    runtime,
    onRegister,
    onPhase,
    ...planInput
  } = input;

  await registerRuntimeModulePlan({
    runtime,
    ...planInput,
    ...(onRegister ? { onRegister } : {})
  });

  onPhase?.("register extension methods");
  await registerAndActivateExtensionsAtStartup({ workspaceDir, eventStore, methods, runPromise });

  onPhase?.("register panel mailbox methods");
  await runtime.registerModules([panelMailboxModule], onRegister);
};
