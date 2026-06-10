import type { createRuntimeHostConfig } from "./runtime-host-config.js";

type RuntimeHostConfig = ReturnType<typeof createRuntimeHostConfig>;

export const createRuntimeBuildStatus = (
  input: {
    config: RuntimeHostConfig;
    service: string;
    startedAt: string;
    runtimeRpcUrl: string;
  } & Record<string, unknown>
) => {
  const { config, service, startedAt, runtimeRpcUrl, ...extra } = input;
  return {
    service,
    status: "running",
    workspaceDir: config.workspaceDir,
    plasticDir: config.plasticDir,
    dataDir: config.runtimePaths.dataDir,
    eventPath: config.eventPath,
    runtimeRpcUrl,
    buildSocket: `http://${config.buildHost}:${config.buildPort}`,
    pid: process.pid,
    startedAt,
    ...extra
  };
};

export const createRuntimeDiagnostics = (
  input: {
    config: RuntimeHostConfig;
  } & Record<string, unknown>
) => {
  const { config, ...extra } = input;
  return {
    cwd: process.cwd(),
    workspaceDir: config.workspaceDir,
    eventPath: config.eventPath,
    ...extra
  };
};
