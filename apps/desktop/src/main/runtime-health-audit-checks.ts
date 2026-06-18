const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const checkAuditMetadata = (rawAudit: unknown, source: string) => {
  const audit = asRecord(rawAudit);
  const runtimeUnification = asRecord(audit.runtimeUnification);
  const methodParity = audit.methodParity === undefined ? runtimeUnification.methodParity : audit.methodParity;
  const usable = audit.usable ?? runtimeUnification.usable;
  const strictElectron = audit.strictElectron ?? runtimeUnification.strictElectron;
  const unified = audit.unified ?? runtimeUnification.unified;
  const expectedStepIds = Array.isArray(audit.expectedStepIds)
    ? audit.expectedStepIds.filter((id): id is string => typeof id === "string")
    : [];
  if (audit.schemaVersion !== 1) {
    throw new Error(`${source} missing audit schema version`);
  }
  if (typeof audit.generatedAt !== "string" || Number.isNaN(Date.parse(audit.generatedAt))) {
    throw new Error(`${source} missing audit generated timestamp`);
  }
  if (typeof audit.checks !== "number" || typeof audit.expectedChecks !== "number" || expectedStepIds.length !== audit.expectedChecks) {
    throw new Error(`${source} audit check counts are incomplete`);
  }
  if (typeof audit.inProgress !== "boolean") {
    throw new Error(`${source} audit progress flag is incomplete`);
  }
  if (typeof usable !== "boolean" || typeof strictElectron !== "string" || typeof unified !== "string") {
    throw new Error(`${source} runtime unification metadata is incomplete`);
  }
  const methodParityMetadata = checkMethodParityMetadata(methodParity, source);
  return {
    schemaVersion: audit.schemaVersion,
    generatedAt: audit.generatedAt,
    inProgress: audit.inProgress,
    usable,
    strictElectron,
    unified,
    checks: audit.checks,
    expectedChecks: audit.expectedChecks,
    expectedStepIds,
    methodParity: methodParityMetadata
  };
};

const checkMethodParityMetadata = (rawMethodParity: unknown, source: string) => {
  if (rawMethodParity === null) {
    return { mode: "not-run", failureTotal: null, reportPath: null };
  }
  const methodParity = asRecord(rawMethodParity);
  const failureSummary = asRecord(methodParity.failureSummary);
  const failureTotal = methodParity.failureTotal ?? failureSummary.total;
  const reportPath = methodParity.reportPath;
  if (typeof methodParity.mode !== "string") {
    throw new Error(`${source} audit method parity mode is incomplete`);
  }
  if (failureTotal !== null && typeof failureTotal !== "number") {
    throw new Error(`${source} audit method parity failure total is incomplete`);
  }
  if (reportPath !== undefined && reportPath !== null && typeof reportPath !== "string") {
    throw new Error(`${source} audit method parity report path is incomplete`);
  }
  return {
    mode: methodParity.mode,
    failureTotal: failureTotal ?? null,
    reportPath: reportPath ?? null
  };
};
