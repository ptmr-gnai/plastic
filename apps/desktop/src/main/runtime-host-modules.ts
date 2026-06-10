import { createExtensionAuthoringModule } from "./extension-authoring-methods.js";
import { createRuntimeBuildModule, type RuntimeCommandResult } from "./runtime-build-methods.js";
import { createRuntimeDiagnosticsModule } from "./runtime-diagnostics-methods.js";

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
