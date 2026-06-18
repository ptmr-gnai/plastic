export const assertRuntimeAuditStatus = (auditStatus) => {
  assert(typeof auditStatus?.available === "boolean", "runtime/auditStatus missing availability");
  assert(typeof auditStatus.path === "string" && auditStatus.path.includes("runtime-unification-audit.json"), "runtime/auditStatus missing audit path");
  assert(["missing", "running", "passed", "degraded", "failed"].includes(auditStatus.verdict?.status), "runtime/auditStatus missing compact verdict");
  assert(typeof auditStatus.verdict?.diagnosis?.code === "string", "runtime/auditStatus missing diagnosis code");
  assert(typeof auditStatus.verdict?.diagnosis?.summary === "string", "runtime/auditStatus missing diagnosis summary");
  assert(typeof auditStatus.verdict?.failureSummary?.count === "number", "runtime/auditStatus missing verdict failure count");
  assert(typeof auditStatus.verdict?.methodParity?.mode === "string", "runtime/auditStatus missing verdict method parity mode");
  assert(auditStatus.verdict.methodParity.failureTotal === null || typeof auditStatus.verdict.methodParity.failureTotal === "number", "runtime/auditStatus invalid verdict method parity total");
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
  assertRecentAuditActionMetadata(auditStatus.recentActions, "runtime/auditStatus");
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
  assert(description.outputSchema?.properties?.verdict?.required?.includes("methodParity"), "runtime/auditStatus output schema must require method parity");
  assert(description.outputSchema?.properties?.verdict?.properties?.methodParity?.required?.includes("failureTotal"), "runtime/auditStatus output schema must expose method parity total");
  assert(description.outputSchema?.properties?.verdict?.properties?.methodParity?.required?.includes("reportPath"), "runtime/auditStatus output schema must expose method parity report path");
  assert(description.outputSchema?.properties?.verdict?.properties?.diagnosis?.required?.includes("code"), "runtime/auditStatus output schema must expose diagnosis code");
  assert(description.outputSchema?.properties?.verdict?.properties?.diagnosis?.required?.includes("summary"), "runtime/auditStatus output schema must expose diagnosis summary");
  assert(description.outputSchema?.properties?.verdict?.properties?.failureSummary?.required?.includes("blockingIds"), "runtime/auditStatus output schema must expose blocking failure ids");
  assert(description.outputSchema?.properties?.verdict?.properties?.failureSummary?.required?.includes("first"), "runtime/auditStatus output schema must expose first failure");
  assert(description.outputSchema?.properties?.recentActions?.items?.required?.includes("stdoutTail"), "runtime/auditStatus output schema must expose recent action tails");
  assert(description.outputSchema?.properties?.recentActions?.items?.properties?.auditMetadata?.anyOf?.some((candidate) => candidate.properties?.methodParity), "runtime/auditStatus output schema must expose recent action method parity metadata");
  assert(description.outputSchema?.properties?.summary?.anyOf?.some((candidate) => candidate.properties?.inProgress?.type === "boolean"), "runtime/auditStatus output schema must expose summary.inProgress");
  assert(description.outputSchema?.properties?.summary?.anyOf?.some((candidate) => candidate.required?.includes("runtimeUnification") && candidate.required?.includes("failures") && candidate.required?.includes("results")), "runtime/auditStatus output schema must expose persisted audit summary fields");
  const summarySchema = description.outputSchema?.properties?.summary?.anyOf?.find((candidate) => candidate.required?.includes("results"));
  assert(summarySchema?.properties?.results?.items?.required?.includes("id"), "runtime/auditStatus summary result schema must require id");
  assert(summarySchema?.properties?.results?.items?.required?.includes("ok"), "runtime/auditStatus summary result schema must require ok");
  assert(summarySchema?.properties?.results?.items?.required?.includes("command"), "runtime/auditStatus summary result schema must require command");
  assert(summarySchema?.properties?.results?.items?.properties?.diagnostics?.properties?.tail?.items?.type === "string", "runtime/auditStatus summary result diagnostics must expose tail lines");
  return { id: description.id, statuses: description.outputSchema.properties.verdict.properties.status.enum };
};

export const assertRuntimeAuditActionPlanMethodDescription = ({ assert, description }) => {
  assert(description.id === "runtime/auditActionPlan", "described wrong audit action plan method");
  assert(description.outputSchema?.required?.includes("invocation"), "runtime/auditActionPlan output schema must require invocation");
  assert(description.outputSchema?.required?.includes("audit"), "runtime/auditActionPlan output schema must require audit");
  assert(description.outputSchema?.properties?.invocation?.properties?.method?.enum?.includes("runtime/runAuditAction"), "runtime/auditActionPlan output schema must expose run invocation method");
  assert(description.outputSchema?.properties?.audit?.properties?.status?.enum?.includes("running"), "runtime/auditActionPlan output schema must expose audit running status");
  assert(description.outputSchema?.properties?.audit?.properties?.diagnosis?.required?.includes("code"), "runtime/auditActionPlan output schema must expose audit diagnosis code");
  assert(description.outputSchema?.properties?.audit?.properties?.diagnosis?.required?.includes("summary"), "runtime/auditActionPlan output schema must expose audit diagnosis summary");
  assert(description.outputSchema?.properties?.audit?.properties?.metadata?.properties?.methodParity?.required?.includes("failureTotal"), "runtime/auditActionPlan output schema must expose audit method parity total");
  assert(description.outputSchema?.properties?.audit?.properties?.metadata?.properties?.methodParity?.required?.includes("reportPath"), "runtime/auditActionPlan output schema must expose audit method parity report path");
  return { id: description.id, required: description.outputSchema.required };
};

export const assertRunAuditActionMethodDescription = ({ assert, description }) => {
  assert(description.id === "runtime/runAuditAction", "described wrong audit action method");
  assert(description.outputSchema?.required?.includes("eventId"), "runtime/runAuditAction output schema must require eventId");
  assert(description.outputSchema?.required?.includes("auditMetadata"), "runtime/runAuditAction output schema must require auditMetadata");
  assert(description.outputSchema?.properties?.auditMetadata?.properties?.methodParity?.required?.includes("failureTotal"), "runtime/runAuditAction output schema must expose audit method parity total");
  assert(description.outputSchema?.properties?.auditMetadata?.properties?.methodParity?.required?.includes("reportPath"), "runtime/runAuditAction output schema must expose audit method parity report path");
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
  assert(summary.runtimeUnification.methodParity === null || typeof summary.runtimeUnification.methodParity?.failureSummary?.total === "number", "runtime/auditStatus missing method parity failure summary");
  assert(typeof summary?.failures?.count === "number", "runtime/auditStatus missing audit failure count");
  assert(Array.isArray(summary.failures.ids), "runtime/auditStatus missing audit failure ids");
  assert(Array.isArray(summary.failures.blockingIds), "runtime/auditStatus missing audit blocking failure ids");
  assert(summary.failures.first === null || typeof summary.failures.first?.id === "string", "runtime/auditStatus invalid first failure summary");
  const failedResults = summary.results?.filter((result) => result.ok === false) ?? [];
  assert(failedResults.every((result) => result.diagnostics === undefined || Array.isArray(result.diagnostics.tail)), "runtime/auditStatus failure diagnostics must include output tail when present");
};

const assertRecentAuditActionMetadata = (recentActions, source) => {
  for (const action of recentActions) {
    if (action.auditMetadata === null) {
      continue;
    }
    assertCompactAuditMetadata(action.auditMetadata, `${source} recent audit action metadata`);
  }
};

const assertCompactAuditMetadata = (metadata, source) => {
  assert(metadata?.schemaVersion === 1, `${source} must be schema-versioned`);
  assert(typeof metadata.generatedAt === "string" && !Number.isNaN(Date.parse(metadata.generatedAt)), `${source} missing generated timestamp`);
  assert(typeof metadata.inProgress === "boolean", `${source} missing progress flag`);
  assert(typeof metadata.checks === "number", `${source} missing check count`);
  assert(typeof metadata.expectedChecks === "number", `${source} missing expected check count`);
  assert(Array.isArray(metadata.expectedStepIds), `${source} missing expected step ids`);
  assert(typeof metadata.usable === "boolean", `${source} missing usable flag`);
  assert(typeof metadata.strictElectron === "string", `${source} missing strict Electron status`);
  assert(typeof metadata.unified === "string", `${source} missing unified status`);
  assert(typeof metadata.methodParity?.mode === "string", `${source} missing method parity mode`);
  assert(metadata.methodParity.reportPath === null || typeof metadata.methodParity.reportPath === "string", `${source} invalid method parity report path`);
  assert(metadata.methodParity.failureTotal === null || typeof metadata.methodParity.failureTotal === "number", `${source} invalid method parity total`);
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
