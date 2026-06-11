import type { EventStore, MethodRegistry } from "@plastic/core";
import {
  prepareBundledExtensionStateAtStartup,
  registerAndActivateExtensionsAtStartup
} from "./extension-startup.js";
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
  runtime: Pick<PlasticRuntime, "appendEvent" | "registerModules">;
  onRegister?: (module: RuntimeModule) => void;
  onPhase?: (phase: string) => void;
};

export type RuntimeStartupSequenceInput = CoreRuntimeStartupInput & {
  bundledExtensionsDir: string;
  startedPayload: Record<string, unknown>;
};

export const appendRuntimeStartedEvent = (
  runtime: Pick<PlasticRuntime, "appendEvent">,
  payload: Record<string, unknown>
) =>
  runtime.appendEvent({
    type: "runtime.started",
    payload
  });

export const registerCoreRuntimeModulesAtStartup = async (input: CoreRuntimeStartupInput) => {
  const {
    workspaceDir,
    eventStore: _eventStore,
    methods: _methods,
    runPromise: _runPromise,
    runtime,
    onRegister,
    onPhase: _onPhase,
    ...planInput
  } = input;
  const tailModules: RuntimeModule[] = [
    {
      id: "extension-runtime",
      register: async ({ eventStore, methods, runPromise }) => {
        await registerAndActivateExtensionsAtStartup({ workspaceDir, eventStore, methods, runPromise });
      }
    },
    panelMailboxModule,
    ...(planInput.tailModules ?? [])
  ];

  return registerRuntimeModulePlan({
    runtime,
    ...planInput,
    tailModules,
    ...(onRegister ? { onRegister } : {})
  });
};

export const runRuntimeStartupSequence = async (input: RuntimeStartupSequenceInput) => {
  input.onPhase?.("ensure bundled extensions");
  await prepareBundledExtensionStateAtStartup({
    workspaceDir: input.workspaceDir,
    bundledExtensionsDir: input.bundledExtensionsDir,
    eventStore: input.eventStore,
    runPromise: input.runPromise
  });

  input.onPhase?.("register runtime methods");
  await registerCoreRuntimeModulesAtStartup(input);
  const moduleInventory = await input.runPromise(input.methods.call("runtime/modules", {}));
  const capabilityInventory = await input.runPromise(input.methods.call("runtime/capabilities", {}));
  await appendRuntimeStartedEvent(input.runtime, {
    ...input.startedPayload,
    capabilities: Array.isArray((capabilityInventory as { items?: unknown })?.items)
      ? (capabilityInventory as { items: unknown[] }).items
      : [],
    modules: Array.isArray((moduleInventory as { items?: unknown })?.items)
      ? (moduleInventory as { items: unknown[] }).items
      : []
  });
};
