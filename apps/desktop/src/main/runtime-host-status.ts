import type { createRuntimeHostConfig } from "./runtime-host-config.js";
import type { PlasticState } from "@plastic/core";
import { rpcCallInputSchema } from "./runtime-control-schemas.js";

type RuntimeHostConfig = ReturnType<typeof createRuntimeHostConfig>;
type RuntimeMode = "electron" | "headless";

export const runtimeHostBaseDescriptor = {
  id: "runtime-host-base",
  version: 1
} as const;

const createAgentTransportDescriptors = (config: RuntimeHostConfig) => [
  {
    id: "http-rpc",
    title: "HTTP RPC",
    status: "available",
    transport: "http",
    methodRegistry: "shared",
    rpcUrl: config.controlPlane.runtime.rpcUrl,
    links: [
      { rel: "methods", href: config.controlPlane.runtime.methodsUrl, method: "http/get" },
      { rel: "self-test", href: config.controlPlane.runtime.selfTestUrl, method: "http/get" },
      { rel: "rpc", href: config.controlPlane.runtime.rpcUrl, method: "http/post" }
    ],
    actions: [
      { id: "call-plastic-rpc", title: "Call Plastic RPC over HTTP", method: "http/post", href: config.controlPlane.runtime.rpcUrl, inputSchema: rpcCallInputSchema }
    ],
    notes: "Primary local RPC transport for renderers, scripts, and outside agents."
  },
  {
    id: "mcp-stdio",
    title: "MCP stdio bridge",
    status: "available",
    transport: "stdio",
    methodRegistry: "shared",
    command: "node",
    args: ["scripts/plastic-mcp-server.mjs"],
    env: {
      PLASTIC_RPC_URL: config.controlPlane.runtime.rpcUrl
    },
    tools: [
      {
        name: "plastic_rpc",
        methodRegistry: "shared",
        description: "Calls any registered Plastic RPC method through the shared method registry."
      }
    ],
    actions: [
      {
        id: "call-plastic-rpc",
        title: "Call Plastic RPC through MCP",
        tool: "plastic_rpc",
        arguments: { method: "agent/orient", input: {} },
        inputSchema: rpcCallInputSchema
      }
    ],
    notes: "Adapter transport for agents that cannot reach local TCP directly; calls the same Plastic RPC method registry."
  }
];

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
    controlPlane: config.controlPlane,
    agentTransports: createAgentTransportDescriptors(config),
    buildSocket: config.controlPlane.build.baseUrl,
    hostBase: runtimeHostBaseDescriptor,
    pid: process.pid,
    startedAt,
    ...extra
  };
};

export const createRuntimeHostDescriptor = (
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
    controlPlane: config.controlPlane,
    agentTransports: createAgentTransportDescriptors(config),
    hostBase: runtimeHostBaseDescriptor,
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
    hostBase: runtimeHostBaseDescriptor,
    ...extra
  };
};

export const createRuntimeHostStatusAccessors = (input: {
  config: RuntimeHostConfig;
  mode: RuntimeMode;
  service: string;
  startedAt: string;
  runtimeRpcUrl: string;
  getBuildStatusExtra?: () => Record<string, unknown>;
  getDiagnosticsExtra?: () => Record<string, unknown>;
}) => ({
  host: () =>
    createRuntimeHostDescriptor({
      config: input.config,
      mode: input.mode,
      service: input.service,
      startedAt: input.startedAt,
      runtimeRpcUrl: input.runtimeRpcUrl
    }),
  buildStatus: () =>
    createRuntimeBuildStatus({
      config: input.config,
      mode: input.mode,
      service: input.service,
      startedAt: input.startedAt,
      runtimeRpcUrl: input.runtimeRpcUrl,
      ...(input.getBuildStatusExtra?.() ?? {})
    }),
  diagnostics: () =>
    createRuntimeDiagnostics({
      config: input.config,
      mode: input.mode,
      ...(input.getDiagnosticsExtra?.() ?? {})
    })
});

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
  app: { ...input.state.app, mode: input.mode, hostBase: runtimeHostBaseDescriptor },
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
        { rel: "methods", href: "plastic/methods", method: "plastic/methods" },
        { rel: "host", href: "runtime/host", method: "runtime/host" },
        { rel: "capabilities", href: "runtime/capabilities", method: "runtime/capabilities" }
      ],
      actions: [
        { id: "call", title: "Call RPC method", method: "rpc/call", inputSchema: rpcCallInputSchema },
        { id: "read-host", title: "Read runtime host", method: "runtime/host" },
        { id: "read-capabilities", title: "Read host capabilities", method: "runtime/capabilities" }
      ]
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
    hostBase: runtimeHostBaseDescriptor,
    workspaceDir: config.workspaceDir,
    eventPath: config.eventPath,
    ...extra
  };
};
