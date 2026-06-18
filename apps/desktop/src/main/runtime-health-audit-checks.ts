const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const checkAuditMetadata = (rawAudit: unknown, source: string) => {
  const audit = asRecord(rawAudit);
  const runtimeUnification = asRecord(audit.runtimeUnification);
  const methodParity = audit.methodParity === undefined ? runtimeUnification.methodParity : audit.methodParity;
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
  const methodParityMetadata = checkMethodParityMetadata(methodParity, source);
  return {
    schemaVersion: audit.schemaVersion,
    generatedAt: audit.generatedAt,
    checks: audit.checks,
    expectedChecks: audit.expectedChecks,
    expectedStepIds,
    methodParity: methodParityMetadata
  };
};

const checkMethodParityMetadata = (rawMethodParity: unknown, source: string) => {
  if (rawMethodParity === null) {
    return { mode: "not-run", failureTotal: null };
  }
  const methodParity = asRecord(rawMethodParity);
  const failureSummary = asRecord(methodParity.failureSummary);
  const failureTotal = methodParity.failureTotal ?? failureSummary.total;
  if (typeof methodParity.mode !== "string") {
    throw new Error(`${source} audit method parity mode is incomplete`);
  }
  if (failureTotal !== null && typeof failureTotal !== "number") {
    throw new Error(`${source} audit method parity failure total is incomplete`);
  }
  return {
    mode: methodParity.mode,
    failureTotal: failureTotal ?? null
  };
};
