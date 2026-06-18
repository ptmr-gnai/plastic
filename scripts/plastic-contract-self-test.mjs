export const assertSelfTestSurface = ({ assert, selfTest }) => {
  assert(selfTest.ok === true, "plastic/selfTest failed");
  assert(selfTest.summary?.total === selfTest.checks?.length, "plastic/selfTest summary total does not match checks");
  assert(selfTest.summary?.shared > 0, "plastic/selfTest summary missing shared checks");
  assert(Array.isArray(selfTest.summary?.hostCheckIds), "plastic/selfTest summary missing host check ids");
  assert(selfTest.summary?.failedIds?.length === 0, "plastic/selfTest summary reported failed checks");
  const methodCheck = selfTest.checks?.find((candidate) => candidate.id === "methods:list");
  assert(methodCheck?.details?.invalidIdentity?.length === 0, "plastic/selfTest method identity check failed");
  assert(methodCheck?.details?.missingAvailability?.length === 0, "plastic/selfTest method availability check failed");
  assert(methodCheck.details.invalidAvailabilityStatuses?.length === 0, "plastic/selfTest method availability status check failed");
  assert(methodCheck.details.missingReferencedCapabilities?.length === 0, "plastic/selfTest method capability reference check failed");
  assert(methodCheck.details.requiredDiagnosticsMethods === true, "plastic/selfTest diagnostics method check failed");
  const methodAffordanceCheck = selfTest.checks?.find((candidate) => candidate.id === "methods:affordances");
  assert(methodAffordanceCheck?.details?.missingDescribeLinks?.length === 0, "plastic/selfTest method describe links missing");
  assert(methodAffordanceCheck.details.missingInvokeLinks?.length === 0, "plastic/selfTest method invoke links missing");
  assert(methodAffordanceCheck.details.invalidDescribeLinks?.length === 0, "plastic/selfTest method describe links invalid");
  assert(methodAffordanceCheck.details.invalidInvokeLinks?.length === 0, "plastic/selfTest method invoke links invalid");
  const buildCheck = selfTest.checks?.find((candidate) => candidate.id === "build:surface");
  assert(buildCheck?.details?.invalidControlPlaneEndpointUrls?.length === 0, "plastic/selfTest build/status control-plane URLs are invalid");
  assert(buildCheck?.details?.invalidTransportAffordances?.length === 0, "plastic/selfTest build/status transport affordances are invalid");
  const projectionCheck = selfTest.checks?.find((candidate) => candidate.id === "projections:discovery");
  assert(projectionCheck?.details?.invalidStateControlPlaneUrls?.length === 0, "plastic/selfTest state control-plane URLs are invalid");
  assert(projectionCheck.details.invalidSnapshotControlPlaneUrls?.length === 0, "plastic/selfTest snapshot control-plane URLs are invalid");
  assert(projectionCheck.details.invalidResourceAffordances?.length === 0, "plastic/selfTest projection resource affordances are invalid");
  const capabilityCheck = selfTest.checks?.find((candidate) => candidate.id === "capabilities:list");
  assert(capabilityCheck?.details?.missingRequiredCapabilities?.length === 0, "plastic/selfTest required capability check failed");
  assert(capabilityCheck.details.invalidStatuses?.length === 0, "plastic/selfTest capability status check failed");
  const startedCapabilitiesCheck = selfTest.checks?.find((candidate) => candidate.id === "runtime-started:capabilities");
  assert(startedCapabilitiesCheck?.details?.capabilitiesMatch === true, "plastic/selfTest runtime.started capabilities diverged from live capabilities");
  const moduleCheck = selfTest.checks?.find((candidate) => candidate.id === "runtime-modules:map");
  assert(moduleCheck?.details?.missingRequiredModules?.length === 0, "plastic/selfTest required module check failed");
  assert(moduleCheck.details.missingAgentBackend === false, "plastic/selfTest agent backend module check failed");
  assert(moduleCheck.details.requiredHostModule === true, "plastic/selfTest host module check failed");
  assert(moduleCheck.details.missingMethodIds?.length === 0, "plastic/selfTest module methodIds check failed");
  assert(moduleCheck.details.invalidModuleOrder?.length === 0, "plastic/selfTest runtime module order check failed");
  assert(moduleCheck.details.invalidOrderFields?.length === 0, "plastic/selfTest runtime module order field check failed");
  assert(moduleCheck.details.missingAvailabilitySummary?.length === 0, "plastic/selfTest module availability summary check failed");
  assert(moduleCheck.details.invalidAvailabilityCounts?.length === 0, "plastic/selfTest module availability count check failed");
  assert(moduleCheck.details.missingContributions?.length === 0, "plastic/selfTest module contribution check failed");
  const startedModulesCheck = selfTest.checks?.find((candidate) => candidate.id === "runtime-started:modules");
  assert(startedModulesCheck?.details?.idsMatch === true, "plastic/selfTest runtime.started module ids diverged");
  assert(startedModulesCheck.details.methodsMatch === true, "plastic/selfTest runtime.started module methods diverged");
  assert(startedModulesCheck.details.availabilityMatch === true, "plastic/selfTest runtime.started module availability diverged");
  const startedCheck = selfTest.checks?.find((candidate) => candidate.id === "runtime-started:descriptor");
  assert(startedCheck?.details?.invalidStartedControlPlaneUrls?.length === 0, "plastic/selfTest runtime.started control-plane URLs are invalid");
  const hostIdentityCheck = selfTest.checks?.find((candidate) => candidate.id === "runtime-host:identity");
  assert(hostIdentityCheck?.details?.mismatchedIdentityFields?.length === 0, "plastic/selfTest host identity check failed");
  assert(hostIdentityCheck.details.invalidHostControlPlaneUrls?.length === 0, "plastic/selfTest runtime/host control-plane URLs are invalid");
  assert(hostIdentityCheck.details.agentTransportsMatch === true, "plastic/selfTest host transport identity check failed");
  const auditCheck = selfTest.checks?.find((candidate) => candidate.id === "runtime-audit:status");
  assert(["missing", "running", "passed", "degraded", "failed"].includes(auditCheck?.details?.status), "plastic/selfTest audit status check failed");
  assert(typeof auditCheck.details.methodParity?.mode === "string", "plastic/selfTest audit status missing method parity mode");
  assert(auditCheck.details.methodParity.failureTotal === null || typeof auditCheck.details.methodParity.failureTotal === "number", "plastic/selfTest audit status invalid method parity total");
  assert(typeof auditCheck.details.actions === "number", "plastic/selfTest audit status actions check failed");
  assert(auditCheck.details.invalidActionInvocations?.length === 0, "plastic/selfTest audit actions have invalid invocation metadata");
  const transportCheck = selfTest.checks?.find((candidate) => candidate.id === "agent-transports:affordances");
  assert(transportCheck?.ok === true, "plastic/selfTest agent transport affordance check failed");
  assert(transportCheck.details?.ids?.includes("http-rpc"), "plastic/selfTest missing HTTP RPC transport health");
  assert(transportCheck.details?.ids?.includes("mcp-stdio"), "plastic/selfTest missing MCP transport health");
  assert(transportCheck.details?.mcpTool === "plastic_rpc", "plastic/selfTest missing plastic_rpc transport health");
  assert(transportCheck.details.invalidTransportAffordances?.length === 0, "plastic/selfTest agent transport affordances are invalid");
  const orientationCheck = selfTest.checks?.find((candidate) => candidate.id === "agent-orientation:packets");
  assert(orientationCheck?.details?.unknownWorkbenchActions?.length === 0, "plastic/selfTest workbench action references unknown methods");
  assert(orientationCheck.details.unknownWorkbenchLinks?.length === 0, "plastic/selfTest workbench link references unknown methods");
  assert(orientationCheck.details.unknownOrientationActions?.length === 0, "plastic/selfTest orientation action references unknown methods");
  assert(orientationCheck.details.unknownOrientationLinks?.length === 0, "plastic/selfTest orientation link references unknown methods");
  assert(orientationCheck.details.vagueInputs?.length === 0, "plastic/selfTest agent packet affordances have vague inputs");
  assert(typeof orientationCheck.details.auditMetadata?.inProgress === "boolean", "plastic/selfTest workbench audit metadata missing progress flag");
  assert(typeof orientationCheck.details.auditMetadata.usable === "boolean", "plastic/selfTest workbench audit metadata missing usability flag");
  assert(typeof orientationCheck.details.auditMetadata.strictElectron === "string", "plastic/selfTest workbench audit metadata missing strict Electron verdict");
  assert(typeof orientationCheck.details.auditMetadata.unified === "string", "plastic/selfTest workbench audit metadata missing unified verdict");
  assert(orientationCheck.details.auditMetadata.methodParity?.reportPath === null || typeof orientationCheck.details.auditMetadata.methodParity?.reportPath === "string", "plastic/selfTest workbench audit metadata invalid method parity report path");
  assert(typeof orientationCheck.details.orientationAuditMetadata?.inProgress === "boolean", "plastic/selfTest orient audit metadata missing progress flag");
  assert(typeof orientationCheck.details.orientationAuditMetadata.usable === "boolean", "plastic/selfTest orient audit metadata missing usability flag");
  assert(typeof orientationCheck.details.orientationAuditMetadata.strictElectron === "string", "plastic/selfTest orient audit metadata missing strict Electron verdict");
  assert(typeof orientationCheck.details.orientationAuditMetadata.unified === "string", "plastic/selfTest orient audit metadata missing unified verdict");
  assert(orientationCheck.details.orientationAuditMetadata.methodParity?.reportPath === null || typeof orientationCheck.details.orientationAuditMetadata.methodParity?.reportPath === "string", "plastic/selfTest orient audit metadata invalid method parity report path");
  return { checks: selfTest.checks?.length ?? null };
};

export const assertSelfTestMethodDescription = ({ assert, description }) => {
  assert(description.id === "plastic/selfTest", "described wrong self-test method");
  assert(description.outputSchema?.required?.includes("summary"), "plastic/selfTest output schema must require summary");
  assert(description.outputSchema?.properties?.summary?.required?.includes("sharedCheckIds"), "plastic/selfTest summary schema must expose sharedCheckIds");
  assert(description.outputSchema?.properties?.summary?.required?.includes("hostCheckIds"), "plastic/selfTest summary schema must expose hostCheckIds");
  assert(description.effects?.durableEvents?.includes("plastic.self_test.completed"), "plastic/selfTest missing durable event effect");
  return { id: description.id, summaryRequired: description.outputSchema.properties.summary.required };
};

export const assertSelfTestDurableEvent = async ({ assert, assertArray, rpc, selfTest }) => {
  const selfTestEvents = assertArray(
    await rpc("events/list", { types: ["plastic.self_test.completed"], limit: 5 }),
    "self-test events/list is not an array"
  );
  const durableEvent = selfTestEvents.find((event) => event.id === selfTest.eventId);
  assert(durableEvent, "plastic/selfTest durable event missing");
  assert(
    JSON.stringify(durableEvent.payload?.summary) === JSON.stringify(selfTest.summary),
    "plastic/selfTest durable summary diverged from RPC result"
  );
  assert(
    JSON.stringify(durableEvent.payload?.checks) === JSON.stringify(selfTest.checks),
    "plastic/selfTest durable checks diverged from RPC result"
  );
};

export const assertSelfTestHttpResources = async ({ assert, buildGet, runtimeGet, selfTest }) => {
  const runtimeSelfTest = await runtimeGet("/self-test");
  const buildSelfTest = await buildGet("/self-test");
  assert(runtimeSelfTest.value?.ok === true, "runtime /self-test did not return ok result");
  assert(buildSelfTest.value?.ok === true, "build /self-test did not return ok result");
  assert(runtimeSelfTest.value.summary?.total >= selfTest.summary.total, "runtime /self-test summary missing total");
  assert(buildSelfTest.value.summary?.total >= selfTest.summary.total, "build /self-test summary missing total");
  assertSelfTestSurface({ assert, selfTest: runtimeSelfTest.value });
  assertSelfTestSurface({ assert, selfTest: buildSelfTest.value });
  return {
    runtimeChecks: runtimeSelfTest.value.checks?.length ?? null,
    buildChecks: buildSelfTest.value.checks?.length ?? null
  };
};
