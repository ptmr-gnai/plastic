export const assertRuntimeHostSurface = async ({ assert, assertArray, rpc, mode, runtimeStartedControlPlane, assertMatchingControlPlaneDescriptors }) => {
  const host = await rpc("runtime/host");
  const description = await rpc("methods/describe", { id: "runtime/host" });
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
  return {
    mode: host.mode,
    service: host.service,
    capabilities: host.capabilities.count,
    runtimePort: host.controlPlane.runtime.port
  };
};
