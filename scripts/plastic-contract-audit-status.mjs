export const assertRuntimeAuditStatus = (auditStatus) => {
  assert(typeof auditStatus?.available === "boolean", "runtime/auditStatus missing availability");
  assert(typeof auditStatus.path === "string" && auditStatus.path.includes("runtime-unification-audit.json"), "runtime/auditStatus missing audit path");
  assert(["missing", "running", "passed", "degraded", "failed"].includes(auditStatus.verdict?.status), "runtime/auditStatus missing compact verdict");
  assert(typeof auditStatus.verdict?.diagnosis?.code === "string", "runtime/auditStatus missing diagnosis code");
  assert(typeof auditStatus.verdict?.diagnosis?.summary === "string", "runtime/auditStatus missing diagnosis summary");
  assert(typeof auditStatus.verdict?.failureSummary?.count === "number", "runtime/auditStatus missing verdict failure count");
  assert(Array.isArray(auditStatus.verdict.failureSummary.ids), "runtime/auditStatus missing verdict failure ids");
  assert(Array.isArray(auditStatus.verdict.failureSummary.blockingIds), "runtime/auditStatus missing verdict blocking failure ids");
  assert(auditStatus.verdict.failureSummary.first === null || typeof auditStatus.verdict.failureSummary.first?.id === "string", "runtime/auditStatus invalid verdict first failure");
  assert(typeof auditStatus.verdict?.nextAction === "string", "runtime/auditStatus missing next action");
  assert(Array.isArray(auditStatus.verdict?.actions), "runtime/auditStatus missing diagnostic actions");
  assert(auditStatus.verdict.actions.every((action) => typeof action.id === "string" && typeof action.command === "string"), "runtime/auditStatus diagnostic actions must expose id and command");
  assert(auditStatus.verdict.actions.every((action) => typeof action.run?.command === "string" && Array.isArray(action.run?.args)), "runtime/auditStatus diagnostic actions must expose structured run command");
  assert(auditStatus.verdict.actions.every((action) => action.method === "runtime/runAuditAction" && action.input?.id === action.id), "runtime/auditStatus diagnostic actions must expose Plastic invocation");
  assert(Array.isArray(auditStatus.recentActions), "runtime/auditStatus missing recent audit action results");
  assert(auditStatus.recentActions.every((action) => typeof action.eventId === "string" && typeof action.timestamp === "string" && Array.isArray(action.args)), "runtime/auditStatus recent audit actions have invalid shape");
  assert(auditStatus.recentActions.every((action) => action.env && typeof action.env === "object" && !Array.isArray(action.env)), "runtime/auditStatus recent audit actions must expose env object");
  assert(auditStatus.recentActions.every((action) => action.auditMetadata === null || action.auditMetadata?.schemaVersion === 1), "runtime/auditStatus recent audit action metadata must be null or schema-versioned");
  assert(auditStatus.recentActions.every((action) => typeof action.stdoutTail === "string" && typeof action.stderrTail === "string" && action.stdoutTail.length <= 4000 && action.stderrTail.length <= 4000), "runtime/auditStatus recent audit action tails must be bounded strings");
  assertDiagnosisActions(auditStatus);
  if (auditStatus.available) {
    assertPersistedAuditSummary(auditStatus.summary);
  }
  return { available: auditStatus.available, path: auditStatus.path, usable: auditStatus.summary?.runtimeUnification?.usable ?? null, verdict: auditStatus.verdict.status };
};

export const assertRuntimeAuditStatusMethodDescription = ({ assert, description }) => {
  assert(description.id === "runtime/auditStatus", "described wrong audit status method");
  assert(description.outputSchema?.required?.includes("verdict"), "runtime/auditStatus output schema must require verdict");
  assert(description.outputSchema?.required?.includes("summary"), "runtime/auditStatus output schema must require summary");
  assert(description.outputSchema?.properties?.verdict?.properties?.status?.enum?.includes("running"), "runtime/auditStatus output schema must expose running status");
  assert(description.outputSchema?.properties?.summary?.anyOf?.some((candidate) => candidate.properties?.inProgress?.type === "boolean"), "runtime/auditStatus output schema must expose summary.inProgress");
  return { id: description.id, statuses: description.outputSchema.properties.verdict.properties.status.enum };
};

export const assertRuntimeAuditActionPlanMethodDescription = ({ assert, description }) => {
  assert(description.id === "runtime/auditActionPlan", "described wrong audit action plan method");
  assert(description.outputSchema?.required?.includes("invocation"), "runtime/auditActionPlan output schema must require invocation");
  assert(description.outputSchema?.required?.includes("audit"), "runtime/auditActionPlan output schema must require audit");
  assert(description.outputSchema?.properties?.invocation?.properties?.method?.enum?.includes("runtime/runAuditAction"), "runtime/auditActionPlan output schema must expose run invocation method");
  assert(description.outputSchema?.properties?.audit?.properties?.status?.enum?.includes("running"), "runtime/auditActionPlan output schema must expose audit running status");
  return { id: description.id, required: description.outputSchema.required };
};

export const assertRunAuditActionMethodDescription = ({ assert, description }) => {
  assert(description.id === "runtime/runAuditAction", "described wrong audit action method");
  assert(description.outputSchema?.required?.includes("eventId"), "runtime/runAuditAction output schema must require eventId");
  assert(description.outputSchema?.required?.includes("auditMetadata"), "runtime/runAuditAction output schema must require auditMetadata");
  assert(description.outputSchema?.properties?.ok?.type === "boolean", "runtime/runAuditAction output schema must expose ok");
  assert(description.outputSchema?.properties?.exitCode?.type?.includes("number"), "runtime/runAuditAction output schema must expose numeric exitCode");
  return { id: description.id, required: description.outputSchema.required };
};

const assertPersistedAuditSummary = (summary) => {
  assert(summary?.schemaVersion === 1, "runtime/auditStatus missing audit schema version");
  assert(typeof summary.generatedAt === "string" && !Number.isNaN(Date.parse(summary.generatedAt)), "runtime/auditStatus missing audit generated timestamp");
  assert(typeof summary.inProgress === "boolean", "runtime/auditStatus missing audit progress flag");
  assert(Array.isArray(summary.expectedStepIds), "runtime/auditStatus missing expected audit step ids");
  assert(summary.expectedChecks === summary.expectedStepIds.length, "runtime/auditStatus audit expected check count mismatch");
  assert(summary.checks === summary.results?.length, "runtime/auditStatus audit result count mismatch");
  assert(typeof summary?.runtimeUnification?.usable === "boolean", "runtime/auditStatus missing structured verdict");
  assert(typeof summary?.failures?.count === "number", "runtime/auditStatus missing audit failure count");
  assert(Array.isArray(summary.failures.ids), "runtime/auditStatus missing audit failure ids");
  assert(Array.isArray(summary.failures.blockingIds), "runtime/auditStatus missing audit blocking failure ids");
  assert(summary.failures.first === null || typeof summary.failures.first?.id === "string", "runtime/auditStatus invalid first failure summary");
  const failedResults = summary.results?.filter((result) => result.ok === false) ?? [];
  assert(failedResults.every((result) => result.diagnostics === undefined || Array.isArray(result.diagnostics.tail)), "runtime/auditStatus failure diagnostics must include output tail when present");
};

const assertDiagnosisActions = (auditStatus) => {
  if (auditStatus.verdict.diagnosis?.code === "electron-app-mode-smoke-not-entered") {
    assert(auditStatus.verdict.actions.some((action) => action.id === "force-full-electron-launch-diagnostics"), "runtime/auditStatus smoke failure missing full launch diagnostic action");
    assert(auditStatus.verdict.actions.some((action) => action.id === "probe-electron-launch-targets"), "runtime/auditStatus smoke failure missing launch probe action");
  }
  if (electronLaunchDiagnosisCodes.has(auditStatus.verdict.diagnosis?.code)) {
    assert(auditStatus.verdict.actions.some((action) => action.id === "try-electron-package-launch-mode"), "runtime/auditStatus Electron launch failure missing package launch action");
    assert(auditStatus.verdict.actions.some((action) => action.id === "probe-electron-launch-targets"), "runtime/auditStatus Electron launch failure missing launch probe action");
  }
};

const electronLaunchDiagnosisCodes = new Set([
  "electron-child-running-compiled-main-not-entered",
  "electron-main-entered-startup-missing",
  "electron-cjs-entry-entered-esm-missing",
  "electron-child-running-main-not-entered",
  "electron-app-main-not-entered",
  "electron-main-entry-not-observed",
  "electron-main-startup-missing",
  "electron-runtime-ports-missing"
]);

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};
