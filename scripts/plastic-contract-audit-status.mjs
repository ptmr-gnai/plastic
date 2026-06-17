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
