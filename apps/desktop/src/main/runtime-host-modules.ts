import { createAgentOrientModule } from "./agent-orient-methods.js";
import { createAgentWorkbenchModule } from "./agent-workbench-methods.js";
import { createDeixisMethodModule } from "./deixis-methods.js";
import { createExtensionAuthoringModule } from "./extension-authoring-methods.js";
import { createRendererControlModule } from "./renderer-control-methods.js";
import { createRuntimeBuildModule, type RuntimeCommandResult } from "./runtime-build-methods.js";
import { createRuntimeDiagnosticsModule } from "./runtime-diagnostics-methods.js";
import { createWindowCapabilityModule } from "./window-capability-methods.js";

export const createRuntimeHostAgentModules = (input: {
  workbench: Parameters<typeof createAgentWorkbenchModule>[0];
  orient: Parameters<typeof createAgentOrientModule>[0];
}) => ({
  agentWorkbench: createAgentWorkbenchModule(input.workbench),
  agentOrient: createAgentOrientModule(input.orient)
});

export const createRuntimeHostCapabilityModules = (input: {
  rendererControl?: Parameters<typeof createRendererControlModule>[0];
  windowCapability?: Parameters<typeof createWindowCapabilityModule>[0];
  deixis?: Parameters<typeof createDeixisMethodModule>[0];
} = {}) => ({
  rendererControl: createRendererControlModule(input.rendererControl ?? {}),
  windowCapability: createWindowCapabilityModule(input.windowCapability ?? {}),
  deixis: createDeixisMethodModule(input.deixis ?? {})
});

export const createRuntimeHostSupportModules = (input: {
  plasticDir: string;
  getBuildStatus: () => unknown;
  runCommand: (command: string, args: string[]) => Promise<RuntimeCommandResult>;
  getDiagnostics: () => unknown;
}) => ({
  build: createRuntimeBuildModule({
    getStatus: input.getBuildStatus,
    runCommand: input.runCommand
  }),
  diagnostics: createRuntimeDiagnosticsModule({
    getDiagnostics: input.getDiagnostics
  }),
  extensionAuthoring: createExtensionAuthoringModule({ plasticDir: input.plasticDir })
});
