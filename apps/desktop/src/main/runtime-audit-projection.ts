import type { PlasticEvent } from "@plastic/core";

export type AuditSummary = {
  schemaVersion?: unknown;
  generatedAt?: unknown;
  ok?: unknown;
  inProgress?: unknown;
  checks?: unknown;
  expectedChecks?: unknown;
  expectedStepIds?: unknown;
  failures?: unknown;
  runtimeUnification?: {
    usable?: unknown;
    strictElectron?: unknown;
    unified?: unknown;
    blockingFailures?: unknown;
    methodParity?: unknown;
  };
  results?: unknown;
};

const methodParityMetadata = (summary: AuditSummary | null) => {
  const value = summary?.runtimeUnification?.methodParity;
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as {
    reportPath?: unknown;
    mode?: unknown;
    failureSummary?: { total?: unknown };
  } : null;
  return {
    reportPath: typeof record?.reportPath === "string" ? record.reportPath : null,
    mode: typeof record?.mode === "string" ? record.mode : "unknown",
    failureTotal: typeof record?.failureSummary?.total === "number" ? record.failureSummary.total : null
  };
};

export const compactAuditMetadata = (summary: AuditSummary | null) => ({
  schemaVersion: typeof summary?.schemaVersion === "number" ? summary.schemaVersion : null,
  generatedAt: typeof summary?.generatedAt === "string" ? summary.generatedAt : null,
  inProgress: summary?.inProgress === true,
  checks: typeof summary?.checks === "number" ? summary.checks : null,
  expectedChecks: typeof summary?.expectedChecks === "number" ? summary.expectedChecks : null,
  expectedStepIds: Array.isArray(summary?.expectedStepIds) ? summary.expectedStepIds.filter((id): id is string => typeof id === "string") : [],
  usable: summary?.runtimeUnification?.usable === true,
  strictElectron: typeof summary?.runtimeUnification?.strictElectron === "string" ? summary.runtimeUnification.strictElectron : "unknown",
  unified: typeof summary?.runtimeUnification?.unified === "string" ? summary.runtimeUnification.unified : "unknown",
  methodParity: methodParityMetadata(summary)
});

const normalizeAuditMetadata = (value: unknown) => {
  const metadata = value && typeof value === "object" && !Array.isArray(value)
    ? value as ReturnType<typeof compactAuditMetadata>
    : null;
  return metadata?.schemaVersion === 1 ? metadata : null;
};

const stringEnv = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : {};

export const recentAuditActions = (events: Array<PlasticEvent>) =>
  events
    .filter((event) => event.type === "runtime.auditAction.completed")
    .slice(-5)
    .reverse()
    .map((event) => {
      const payload = event.payload as {
        ok?: unknown;
        action?: { id?: unknown; title?: unknown };
        completedAt?: unknown;
        command?: unknown;
        args?: unknown;
        env?: unknown;
        auditMetadata?: unknown;
        exitCode?: unknown;
        signal?: unknown;
        stdout?: unknown;
        stderr?: unknown;
      };
      const stdout = typeof payload.stdout === "string" ? payload.stdout : "";
      const stderr = typeof payload.stderr === "string" ? payload.stderr : "";
      return {
        eventId: event.id,
        timestamp: event.timestamp,
        actionId: typeof payload.action?.id === "string" ? payload.action.id : null,
        title: typeof payload.action?.title === "string" ? payload.action.title : null,
        ok: payload.ok === true,
        completedAt: typeof payload.completedAt === "string" ? payload.completedAt : event.timestamp,
        command: typeof payload.command === "string" ? payload.command : null,
        args: Array.isArray(payload.args) ? payload.args.filter((arg): arg is string => typeof arg === "string") : [],
        env: stringEnv(payload.env),
        auditMetadata: normalizeAuditMetadata(payload.auditMetadata),
        exitCode: typeof payload.exitCode === "number" ? payload.exitCode : null,
        signal: typeof payload.signal === "string" ? payload.signal : null,
        stdoutTail: stdout.slice(-4000),
        stderrTail: stderr.slice(-4000)
      };
    });
