export const assertRuntimeHostSurface = async ({ assert, assertArray, rpc, mode, runtimeStartedControlPlane, assertMatchingControlPlaneDescriptors }) => {
  const host = await rpc("runtime/host");
  const events = await rpc("events/list", { types: ["runtime.started"], limit: 5 });
  const started = assertArray(events.items ?? events, "runtime.started events/list returned no items").at(-1);
  const description = await rpc("methods/describe", { id: "runtime/host" });
  assert(started?.payload?.host, "runtime.started missing durable host descriptor");
  assert(host?.hostBase?.id === "runtime-host-base", "runtime/host missing shared host base marker");
  assert(host.hostBase.version === 1, "runtime/host host base version mismatch");
  assert(host.mode === mode, "runtime/host mode mismatch");
  assert(host.status === "running", "runtime/host status mismatch");
  assert(host.workspaceDir, "runtime/host missing workspaceDir");
  assert(host.eventPath, "runtime/host missing eventPath");
  assert(host.controlPlane?.runtime?.transport === "http", "runtime/host missing runtime control plane");
  assertMatchingControlPlaneDescriptors({ assert, actual: host.controlPlane, expected: runtimeStartedControlPlane, source: "runtime/host" });
  assertAgentTransports({ assert, assertArray, transports: host.agentTransports, rpcUrl: host.controlPlane.runtime.rpcUrl });
  assert(host.capabilities?.count >= 1, "runtime/host missing capabilities");
  assertArray(host.capabilities.items, "runtime/host capabilities items is not an array");
  assert(host.diagnostics?.mode === mode, "runtime/host diagnostics mode mismatch");
  assert(description.availability?.status === "available", "runtime/host availability mismatch");
  assertMatchingHostIdentity({ assert, live: host, durable: started.payload.host });
  return {
    mode: host.mode,
    service: host.service,
    capabilities: host.capabilities.count,
    agentTransports: host.agentTransports.length,
    runtimePort: host.controlPlane.runtime.port,
    durableEventId: started.id
  };
};

const assertMatchingHostIdentity = ({ assert, live, durable }) => {
  for (const key of ["service", "mode", "status", "workspaceDir", "eventPath", "runtimeRpcUrl", "pid", "startedAt"]) {
    assert(live[key] === durable[key], `runtime/host live and durable ${key} diverged`);
  }
  assert(live.hostBase?.id === durable.hostBase?.id, "runtime/host live and durable hostBase id diverged");
  assert(live.hostBase?.version === durable.hostBase?.version, "runtime/host live and durable hostBase version diverged");
  assert(JSON.stringify(live.agentTransports) === JSON.stringify(durable.agentTransports), "runtime/host live and durable agentTransports diverged");
};

const assertAgentTransports = ({ assert, assertArray, transports, rpcUrl }) => {
  const items = assertArray(transports, "runtime/host agentTransports is not an array");
  const http = items.find((transport) => transport.id === "http-rpc");
  const mcp = items.find((transport) => transport.id === "mcp-stdio");
  assert(http?.status === "available", "runtime/host missing available HTTP RPC transport");
  assert(http.methodRegistry === "shared", "runtime/host HTTP RPC transport must use shared registry");
  assert(http.rpcUrl === rpcUrl, "runtime/host HTTP RPC transport URL mismatch");
  assert(mcp?.status === "available", "runtime/host missing available MCP stdio transport");
  assert(mcp.methodRegistry === "shared", "runtime/host MCP transport must use shared registry");
  assert(mcp.command === "node" && mcp.args?.includes("scripts/plastic-mcp-server.mjs"), "runtime/host MCP transport command mismatch");
  assert(mcp.env?.PLASTIC_RPC_URL === rpcUrl, "runtime/host MCP transport RPC URL mismatch");
};
