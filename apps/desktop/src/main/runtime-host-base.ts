import type { RuntimeCapability } from "./runtime-method-context.js";
import { createGitStatusReader, createWorkspaceCommandRunner } from "./runtime-host-command.js";
import { createRuntimeHostConfig } from "./runtime-host-config.js";
import { createRuntimeHostStatusAccessors } from "./runtime-host-status.js";
import { createPlasticRuntime } from "./runtime-kernel.js";

type RuntimeMode = "electron" | "headless";
type RuntimeHostConfig = ReturnType<typeof createRuntimeHostConfig>;

export const createRuntimeHostBase = async (input: {
  capabilities: RuntimeCapability[];
  getBuildStatusExtra?: (config: RuntimeHostConfig) => Record<string, unknown>;
  getDiagnosticsExtra?: (config: RuntimeHostConfig) => Record<string, unknown>;
  mode: RuntimeMode;
  runtimeRpcUrl?: (config: RuntimeHostConfig) => string;
  service: string;
  startedAt?: string;
}) => {
  const hostConfig = createRuntimeHostConfig();
  const runtime = await createPlasticRuntime({
    workspaceDir: hostConfig.workspaceDir,
    eventPath: hostConfig.eventPath,
    capabilities: input.capabilities
  });
  const runLocalCommand = createWorkspaceCommandRunner(hostConfig.workspaceDir);
  const readGitStatus = createGitStatusReader({ runCommand: runLocalCommand });
  const hostStatus = createRuntimeHostStatusAccessors({
    config: hostConfig,
    mode: input.mode,
    service: input.service,
    startedAt: input.startedAt ?? new Date().toISOString(),
    runtimeRpcUrl: input.runtimeRpcUrl?.(hostConfig) ?? hostConfig.runtimeRpcUrl,
    ...(input.getBuildStatusExtra
      ? { getBuildStatusExtra: () => input.getBuildStatusExtra?.(hostConfig) ?? {} }
      : {}),
    ...(input.getDiagnosticsExtra
      ? { getDiagnosticsExtra: () => input.getDiagnosticsExtra?.(hostConfig) ?? {} }
      : {})
  });

  return {
    hostConfig,
    hostStatus,
    readGitStatus,
    runLocalCommand,
    runtime
  };
};
