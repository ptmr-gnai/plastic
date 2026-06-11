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
  assert(host.capabilities?.count >= 1, "runtime/host missing capabilities");
  assertArray(host.capabilities.items, "runtime/host capabilities items is not an array");
  assert(host.diagnostics?.mode === mode, "runtime/host diagnostics mode mismatch");
  assert(description.availability?.status === "available", "runtime/host availability mismatch");
  assertMatchingHostIdentity({ assert, live: host, durable: started.payload.host });
  return {
    mode: host.mode,
    service: host.service,
    capabilities: host.capabilities.count,
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
};
