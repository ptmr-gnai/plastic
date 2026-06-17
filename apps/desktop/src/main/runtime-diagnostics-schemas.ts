export const auditStatusOutputSchema = {
  type: "object",
  required: ["available", "path", "verdict", "summary", "recentActions"],
  properties: {
    available: { type: "boolean" },
    path: { type: "string" },
    verdict: {
      type: "object",
      required: ["status", "usable", "failureSummary", "diagnosis", "hints", "nextAction", "actions"],
      properties: {
        status: { type: "string", enum: ["missing", "running", "passed", "degraded", "failed"] },
        usable: { type: "boolean" },
        strictElectron: { type: "string" },
        unified: { type: "string" },
        failurePhase: { type: ["string", "null"] },
        failureSummary: { type: "object" },
        diagnosis: { type: "object" },
        hints: { type: "array", items: { type: "string" } },
        nextAction: { type: "string" },
        actions: { type: "array" }
      }
    },
    summary: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          required: ["schemaVersion", "generatedAt", "inProgress", "expectedStepIds", "checks", "expectedChecks"],
          properties: {
            schemaVersion: { type: "number" },
            generatedAt: { type: "string" },
            inProgress: { type: "boolean" },
            expectedStepIds: { type: "array", items: { type: "string" } },
            checks: { type: "number" },
            expectedChecks: { type: "number" }
          }
        }
      ]
    },
    recentActions: { type: "array" }
  }
};
