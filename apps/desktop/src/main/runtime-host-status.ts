import type { createRuntimeHostConfig } from "./runtime-host-config.js";
import type { PlasticState } from "@plastic/core";

type RuntimeHostConfig = ReturnType<typeof createRuntimeHostConfig>;
type RuntimeMode = "electron" | "headless";

export const createRuntimeBuildStatus = (
  input: {
    config: RuntimeHostConfig;
    mode: RuntimeMode;
    service: string;
    startedAt: string;
    runtimeRpcUrl: string;
  } & Record<string, unknown>
) => {
  const { config, mode, service, startedAt, runtimeRpcUrl, ...extra } = input;
  return {
    service,
    mode,
    status: "running",
    workspaceDir: config.workspaceDir,
    plasticDir: config.plasticDir,
    dataDir: config.runtimePaths.dataDir,
    eventPath: config.eventPath,
    runtimeRpcUrl,
    buildSocket: config.controlPlane.build.baseUrl,
    pid: process.pid,
    startedAt,
    ...extra
  };
};

export const createRuntimeDiagnostics = (
  input: {
    config: RuntimeHostConfig;
    mode: RuntimeMode;
  } & Record<string, unknown>
) => {
  const { config, mode, ...extra } = input;
  return {
    mode,
    cwd: process.cwd(),
    workspaceDir: config.workspaceDir,
    eventPath: config.eventPath,
    ...extra
  };
};

export const decorateRuntimeState = (input: {
  state: PlasticState;
  mode: RuntimeMode;
  bus: Record<string, unknown>;
  resource: {
    id: string;
    title: string;
    state: unknown;
    rpcUrl: string;
  };
}) => ({
  ...input.state,
  app: { ...input.state.app, mode: input.mode },
  bus: input.bus,
  resources: [
    ...input.state.resources,
    {
      id: input.resource.id,
      kind: "service",
      title: input.resource.title,
      state: input.resource.state,
      links: [
        { rel: "rpc", href: input.resource.rpcUrl, method: "http/post" },
        { rel: "state", href: "plastic/state", method: "plastic/state" },
        { rel: "methods", href: "plastic/methods", method: "plastic/methods" }
      ],
      actions: [{ id: "call", title: "Call RPC method", method: "rpc/call" }]
    }
  ]
});

export const createSnapshotAppDetails = (
  input: {
    config: RuntimeHostConfig;
    mode: RuntimeMode;
  } & Record<string, unknown>
) => {
  const { config, mode, ...extra } = input;
  return {
    name: "Plastic",
    mode,
    workspaceDir: config.workspaceDir,
    eventPath: config.eventPath,
    ...extra
  };
};
