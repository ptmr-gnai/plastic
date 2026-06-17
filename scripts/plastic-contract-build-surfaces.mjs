import { assertAgentTransports } from "./plastic-contract-agent-transports.mjs";
import { assertControlPlaneEndpointUrls, assertMatchingControlPlaneDescriptors } from "./plastic-contract-control-plane.mjs";
import { stableJson } from "./plastic-stable-json.mjs";

export const assertBuildStatusSurface = async ({
  assert,
  assertArray,
  buildGet,
  rpc,
  state,
  runtimeStartedControlPlane
}) => {
  const build = await rpc("build/status");
  const status = await buildGet("/status");
  assert(build?.status === "running", "build/status did not report running");
  assert(build.mode === state.app.mode, "build/status mode mismatch");
  assert(build.hostBase?.id === "runtime-host-base", "build/status missing shared host base marker");
  assert(build.hostBase?.version === 1, "build/status host base version mismatch");
  assert(status.value?.status === build.status, "build /status did not match build/status");
  assert(status.value?.mode === state.app.mode, "build /status mode mismatch");
  assert(status.value?.workspaceDir === build.workspaceDir, "build /status workspaceDir mismatch");
  assert(build.workspaceDir, "build/status missing workspaceDir");
  assert(build.controlPlane?.runtime?.transport === "http", "build/status missing runtime control plane");
  assert(stableJson(status.value.controlPlane) === stableJson(build.controlPlane), "build /status control plane mismatch");
  assert(stableJson(status.value.agentTransports) === stableJson(build.agentTransports), "build /status agent transports mismatch");
  assertBuildStatusMethodDescription({ assert, description: await rpc("methods/describe", { id: "build/status" }) });
  assertBuildTypecheckMethodDescription({ assert, description: await rpc("methods/describe", { id: "build/typecheck" }) });
  assertAgentTransports({ assert, assertArray, transports: build.agentTransports, rpcUrl: build.controlPlane.runtime.rpcUrl, source: "build/status" });
  assertControlPlaneEndpointUrls({ assert, controlPlane: build.controlPlane, source: "build/status" });
  assertMatchingControlPlaneDescriptors({ assert, actual: build.controlPlane, expected: runtimeStartedControlPlane, source: "build/status" });
  return {
    mode: build.mode,
    service: build.service,
    runtimeRpcUrl: build.runtimeRpcUrl ?? null,
    runtimePort: build.runtimePort ?? null,
    agentTransports: build.agentTransports.length,
    controlPlane: build.controlPlane
  };
};

const assertBuildStatusMethodDescription = ({ assert, description }) => {
  assert(description.outputSchema?.required?.includes("controlPlane"), "build/status output schema must require controlPlane");
  assert(description.outputSchema?.required?.includes("agentTransports"), "build/status output schema must require agentTransports");
  assert(description.outputSchema?.required?.includes("buildSocket"), "build/status output schema must require buildSocket");
  assert(description.outputSchema?.properties?.mode?.enum?.includes("electron"), "build/status output schema must expose electron mode");
  assert(description.outputSchema?.properties?.mode?.enum?.includes("headless"), "build/status output schema must expose headless mode");
  assert(description.outputSchema?.properties?.status?.enum?.includes("running"), "build/status output schema must expose running status");
  assert(description.outputSchema?.properties?.hostBase?.properties?.id?.enum?.includes("runtime-host-base"), "build/status output schema must expose hostBase marker");
  assert(description.outputSchema?.properties?.agentTransports?.items?.properties?.methodRegistry?.enum?.includes("shared"), "build/status output schema must expose shared method registry transports");
};

const assertBuildTypecheckMethodDescription = ({ assert, description }) => {
  assert(description.outputSchema?.required?.includes("ok"), "build/typecheck output schema must require ok");
  assert(description.outputSchema?.required?.includes("command"), "build/typecheck output schema must require command");
  assert(description.outputSchema?.required?.includes("args"), "build/typecheck output schema must require args");
  assert(description.outputSchema?.required?.includes("exitCode"), "build/typecheck output schema must require exitCode");
  assert(description.outputSchema?.required?.includes("eventId"), "build/typecheck output schema must require eventId");
  assert(description.outputSchema?.properties?.ok?.type === "boolean", "build/typecheck output schema must expose ok boolean");
  assert(description.effects?.durableEvents?.includes("build.typecheck.completed"), "build/typecheck must describe completed event");
};

export const assertBuildHttpTransportSurface = async ({
  assert,
  assertArray,
  assertRuntimeStartedControlPlane,
  buildGet,
  buildRpc,
  buildUrl,
  runtimeGet,
  rpc,
  state
}) => {
  const controlPlane = await assertRuntimeStartedControlPlane({ rpc });
  const controlPlaneDescriptor = { runtime: controlPlane.runtime, build: controlPlane.build };
  const runtimeHealth = await runtimeGet("/healthz"), runtimeHost = await runtimeGet("/host"), runtimeCapabilities = await runtimeGet("/capabilities"), runtimeSnapshot = await runtimeGet("/snapshot");
  const health = await buildGet("/healthz"), buildHost = await buildGet("/host"), buildCapabilities = await buildGet("/capabilities"), status = await buildGet("/status"), buildSnapshot = await buildGet("/snapshot");
  const diagnostics = await buildRpc("app/diagnostics", {});
  assert(runtimeHealth.service === "plastic.runtime", "runtime /healthz returned wrong service");
  assert(runtimeHost.value?.mode === state.app.mode, "runtime /host mode mismatch");
  assert(runtimeCapabilities.value?.count >= 1, "runtime /capabilities returned no capabilities");
  assert(runtimeSnapshot.value?.app?.mode === state.app.mode, "runtime /snapshot mode mismatch");
  assert(health.service === "plastic.build", "build /healthz returned wrong service");
  assert(buildHost.value?.mode === runtimeHost.value.mode, "build /host mode mismatch");
  assert(buildHost.value?.hostBase?.id === "runtime-host-base", "build /host missing shared host base marker");
  assert(buildCapabilities.value?.count === runtimeCapabilities.value.count, "build /capabilities count mismatch");
  assert(status.value?.status === "running" && status.value?.mode === state.app.mode, "build /status state mismatch");
  assert(status.value?.hostBase?.id === "runtime-host-base", "build /status missing shared host base marker");
  assert(stableJson(status.value.controlPlane) === stableJson(controlPlaneDescriptor), "build /status control plane does not match startup control plane");
  assertAgentTransports({ assert, assertArray, transports: status.value.agentTransports, rpcUrl: controlPlane.runtime.rpcUrl, source: "build /status" });
  assert(status.value.buildSocket?.endsWith(`:${controlPlane.build.port}`), "build status socket does not match startup control plane");
  assert(buildSnapshot.value?.app?.mode === state.app.mode, "build /snapshot mode mismatch");
  assert(diagnostics?.workspaceDir, "build /rpc app/diagnostics missing workspaceDir");
  assert(diagnostics.mode === state.app.mode, "build /rpc app/diagnostics mode mismatch");
  assert(diagnostics.hostBase?.id === "runtime-host-base", "build /rpc app/diagnostics missing shared host base marker");
  return {
    buildUrl,
    runtimePort: controlPlane.runtime.port,
    buildPort: controlPlane.build.port,
    service: status.value.service,
    statusMode: status.value.mode,
    snapshotMode: buildSnapshot.value.app.mode,
    diagnosticsMode: diagnostics.mode,
    diagnosticsWindowCount: diagnostics.windowCount
  };
};
