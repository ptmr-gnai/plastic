import { agentBackendFallbackModule } from "./agent-backend-fallback-methods.js";
import type { PlasticRuntime } from "./runtime-kernel.js";
import type { RuntimeModule } from "./runtime-method-context.js";
import { panelControlModule } from "./panel-control-methods.js";
import { runtimeControlModule } from "./runtime-control-methods.js";
import { createRuntimeHealthModule } from "./runtime-health-methods.js";
import { createRuntimeModulesModule } from "./runtime-modules-method.js";

export type RuntimeModulePlanInput = {
  state: RuntimeModule;
  snapshot: RuntimeModule;
  agentWorkbench: RuntimeModule;
  agentOrient: RuntimeModule;
  build: RuntimeModule;
  diagnostics: RuntimeModule;
  extensionAuthoring: RuntimeModule;
  rendererControl: RuntimeModule;
  windowCapability: RuntimeModule;
  deixis: RuntimeModule;
  agentBackend?: RuntimeModule | null;
  health?: RuntimeModule | null;
  tailModules?: RuntimeModule[];
};

export const standardRuntimeModuleIds = [
  "runtime-state",
  "runtime-snapshot",
  "agent-workbench",
  "agent-orient",
  "runtime-build",
  "runtime-diagnostics",
  "extension-authoring",
  "renderer-control",
  "agent-backend",
  "runtime-control",
  "panel-control",
  "window-capability",
  "deixis",
  "runtime-health",
  "extension-runtime",
  "panel-mailbox",
  "runtime-host",
  "runtime-modules"
];

export const createRuntimeModulePlan = (input: RuntimeModulePlanInput): RuntimeModule[] => {
  const agentBackend = input.agentBackend === undefined ? agentBackendFallbackModule : input.agentBackend;
  const health = input.health === undefined ? createRuntimeHealthModule() : input.health;
  const modules = [
    input.state,
    input.snapshot,
    input.agentWorkbench,
    input.agentOrient,
    input.build,
    input.diagnostics,
    input.extensionAuthoring,
    input.rendererControl,
    agentBackend,
    runtimeControlModule,
    panelControlModule,
    input.windowCapability,
    input.deixis,
    health,
    ...(input.tailModules ?? [])
  ].filter((module): module is RuntimeModule => Boolean(module));
  let allModules: RuntimeModule[] = [];
  const runtimeModulesModule = createRuntimeModulesModule(() =>
    allModules.map((module, index) => ({
      id: module.id,
      order: index,
      methodIds: module.registeredMethodIds ?? []
    }))
  );
  allModules = [
    ...modules,
    runtimeModulesModule
  ];
  return allModules;
};

export const registerRuntimeModulePlan = (
  input: RuntimeModulePlanInput & {
    runtime: Pick<PlasticRuntime, "registerModules">;
    onRegister?: (module: RuntimeModule) => void;
  }
) => {
  const { runtime, onRegister, ...planInput } = input;
  const modules = createRuntimeModulePlan(planInput);
  return runtime.registerModules(modules, onRegister).then(() => modules);
};
