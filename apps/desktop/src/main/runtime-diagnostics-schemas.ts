export const appDiagnosticsOutputSchema = {
  type: "object",
  required: ["mode", "cwd", "workspaceDir", "eventPath", "hostBase", "windowCount"],
  properties: {
    mode: { type: "string", enum: ["electron", "headless"] },
    cwd: { type: "string" },
    workspaceDir: { type: "string" },
    eventPath: { type: "string" },
    hostBase: {
      type: "object",
      required: ["id", "version"],
      properties: {
        id: { type: "string", enum: ["runtime-host-base"] },
        version: { type: "number" }
      }
    },
    windowCount: { type: "number" },
    appReady: { type: "boolean" }
  }
};

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
        methodParity: { type: "object" },
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

export const auditActionPlanOutputSchema = {
  type: "object",
  required: ["id", "title", "description", "command", "args", "env", "invocation", "audit"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    command: { type: "string" },
    args: { type: "array", items: { type: "string" } },
    env: { type: "object" },
    invocation: {
      type: "object",
      required: ["method", "input"],
      properties: {
        method: { type: "string", enum: ["runtime/runAuditAction"] },
        input: { type: "object", required: ["id"], properties: { id: { type: "string" } } }
      }
    },
    audit: {
      type: "object",
      required: ["metadata", "status", "diagnosis"],
      properties: {
        metadata: { type: "object" },
        status: { type: "string", enum: ["missing", "running", "passed", "degraded", "failed"] },
        diagnosis: { type: "object" }
      }
    }
  }
};

export const runAuditActionOutputSchema = {
  type: "object",
  required: ["ok", "action", "startedAt", "completedAt", "auditMetadata", "command", "args", "env", "exitCode", "stdout", "stderr", "eventId"],
  properties: {
    ok: { type: "boolean" },
    action: { type: "object" },
    startedAt: { type: "string" },
    completedAt: { type: "string" },
    auditMetadata: { type: "object" },
    command: { type: "string" },
    args: { type: "array", items: { type: "string" } },
    env: { type: "object" },
    exitCode: { type: ["number", "null"] },
    signal: { type: ["string", "null"] },
    stdout: { type: "string" },
    stderr: { type: "string" },
    eventId: { type: "string" }
  }
};
