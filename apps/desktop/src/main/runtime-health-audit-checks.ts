const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const checkAuditMetadata = (rawAudit: unknown, source: string) => {
  const audit = asRecord(rawAudit);
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
  return {
    schemaVersion: audit.schemaVersion,
    generatedAt: audit.generatedAt,
    checks: audit.checks,
    expectedChecks: audit.expectedChecks,
    expectedStepIds
  };
};
