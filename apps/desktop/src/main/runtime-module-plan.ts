import { agentBackendFallbackModule } from "./agent-backend-fallback-methods.js";
import type { PlasticRuntime } from "./runtime-kernel.js";
import type { RuntimeModule } from "./runtime-method-context.js";
import { panelControlModule } from "./panel-control-methods.js";
import { runtimeControlModule } from "./runtime-control-methods.js";
import { createRuntimeHealthModule } from "./runtime-health-methods.js";

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
};

export const createRuntimeModulePlan = (input: RuntimeModulePlanInput): RuntimeModule[] => {
  const agentBackend = input.agentBackend === undefined ? agentBackendFallbackModule : input.agentBackend;
  const health = input.health === undefined ? createRuntimeHealthModule() : input.health;
  return [
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
    health
  ].filter((module): module is RuntimeModule => Boolean(module));
};

export const registerRuntimeModulePlan = (
  input: RuntimeModulePlanInput & {
    runtime: Pick<PlasticRuntime, "registerModules">;
    onRegister?: (module: RuntimeModule) => void;
  }
) => {
  const { runtime, onRegister, ...planInput } = input;
  return runtime.registerModules(createRuntimeModulePlan(planInput), onRegister);
};
