import type { MethodRegistry, PlasticMethod } from "@plastic/core";
import { compactAuditMetadata, type AuditSummary } from "./runtime-audit-projection.js";
import type { RunPromise } from "./runtime-method-context.js";

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const readAgentAuditStatus = async (input: {
  methods: MethodRegistry;
  methodList: PlasticMethod[];
  runPromise: RunPromise;
}) => {
  if (!input.methodList.some((method) => method.id === "runtime/auditStatus")) {
    return null;
  }
  const status = asRecord(await input.runPromise(input.methods.call("runtime/auditStatus", {})).catch((error) => ({
    error: error instanceof Error ? error.message : String(error)
  })));
  if (typeof status.error === "string") {
    return { error: status.error };
  }
  const rawSummary = status.summary && typeof status.summary === "object" && !Array.isArray(status.summary)
    ? status.summary as AuditSummary
    : null;
  const verdict = asRecord(status.verdict);
  const auditMetadata = compactAuditMetadata(rawSummary);
  const diagnosis = asRecord(verdict.diagnosis);
  const failureSummary = asRecord(verdict.failureSummary);
  const firstFailure = asRecord(failureSummary.first);
  const actions = Array.isArray(verdict.actions) ? verdict.actions.map(asRecord) : [];
  const recentActions = Array.isArray(status.recentActions) ? status.recentActions.map(asRecord) : [];
  return {
    available: status.available === true,
    audit: auditMetadata,
    verdict: typeof verdict.status === "string" ? verdict.status : "unknown",
    diagnosis: {
      code: typeof diagnosis.code === "string" ? diagnosis.code : "unknown",
      phase: typeof diagnosis.phase === "string" ? diagnosis.phase : null
    },
    failureSummary: {
      count: typeof failureSummary.count === "number" ? failureSummary.count : 0,
      ids: Array.isArray(failureSummary.ids) ? failureSummary.ids.filter((id): id is string => typeof id === "string") : [],
      blockingIds: Array.isArray(failureSummary.blockingIds) ? failureSummary.blockingIds.filter((id): id is string => typeof id === "string") : [],
      first: typeof firstFailure.id === "string"
        ? {
          id: firstFailure.id,
          command: typeof firstFailure.command === "string" ? firstFailure.command : null,
          exit: typeof firstFailure.exit === "number" || typeof firstFailure.exit === "string" ? firstFailure.exit : null
        }
        : null
    },
    nextAction: typeof verdict.nextAction === "string" ? verdict.nextAction : null,
    actionIds: actions.map((action) => action.id).filter((id): id is string => typeof id === "string"),
    recentActions: recentActions.slice(0, 3).map((action) => ({
      actionId: typeof action.actionId === "string" ? action.actionId : null,
      ok: action.ok === true,
      exitCode: typeof action.exitCode === "number" ? action.exitCode : null,
      auditMetadata: action.auditMetadata === null ? null : asRecord(action.auditMetadata),
      env: asRecord(action.env)
    }))
  };
};
