import type { PlasticMethod } from "@plastic/core";
import {
  expectedOrientationActions,
  expectedOrientationLinks,
  expectedWorkbenchActions,
  expectedWorkbenchLinks,
  hasActionAffordance,
  hasLinkAffordance
} from "./runtime-health-affordance-checks.js";
import { checkAuditMetadata } from "./runtime-health-audit-checks.js";

export const checkAgentOrientationHealth = (workbench: unknown, orientation: unknown, methods: PlasticMethod[]) => {
  const methodIds = new Set(methods.map((method) => method.id));
  const workbenchRecord = asRecord(workbench);
  const orientationRecord = asRecord(orientation);
  const control = asRecord(workbenchRecord.control);
  const capabilities = asRecord(orientationRecord.capabilities);
  const workbenchActions = records(control.recommendedActions);
  const workbenchLinks = records(control.links);
  const orientationActions = records(capabilities.recommendedActions);
  const orientationLinks = records(capabilities.links);
  const agentTransports = records(control.agentTransports);
  const auditStatus = asRecord(control.auditStatus);
  const auditMetadata = checkAuditMetadata(auditStatus.audit, "agent/workbench audit status");
  const orientationAuditStatus = asRecord(capabilities.auditStatus);
  const orientationAuditMetadata = checkAuditMetadata(orientationAuditStatus.audit, "agent/orient audit status");
  const failureSummary = asRecord(auditStatus.failureSummary);
  const controlPlane = asRecord(control.controlPlane);
  const runtimeControlPlane = asRecord(controlPlane.runtime);
  const buildControlPlane = asRecord(controlPlane.build);
  const missing = [
    { source: "agent/workbench", kind: "actions", ids: expectedWorkbenchActions.filter((action) => !hasActionAffordance(workbenchActions, action)).map((action) => action.id) },
    { source: "agent/workbench", kind: "links", ids: expectedWorkbenchLinks.filter((link) => !hasLinkAffordance(workbenchLinks, link)).map((link) => link.rel) },
    { source: "agent/orient", kind: "actions", ids: expectedOrientationActions.filter((action) => !hasActionAffordance(orientationActions, action)).map((action) => action.id) },
    { source: "agent/orient", kind: "links", ids: expectedOrientationLinks.filter((link) => !hasLinkAffordance(orientationLinks, link)).map((link) => link.rel) }
  ].find(({ ids }) => ids.length > 0);
  const unknownWorkbenchActions = unknownMethodReferences(workbenchActions, methodIds), unknownWorkbenchLinks = unknownMethodReferences(workbenchLinks, methodIds);
  const unknownOrientationActions = unknownMethodReferences(orientationActions, methodIds), unknownOrientationLinks = unknownMethodReferences(orientationLinks, methodIds);
  const vagueInputs = [
    ...invalidInputAffordances(workbenchActions, methods, "agent/workbench actions"),
    ...invalidInputAffordances(workbenchLinks, methods, "agent/workbench links"),
    ...invalidInputAffordances(orientationActions, methods, "agent/orient actions"),
    ...invalidInputAffordances(orientationLinks, methods, "agent/orient links")
  ];
  if (runtimeControlPlane.transport !== "http" || buildControlPlane.transport !== "http") {
    throw new Error("agent/workbench missing shared runtime/build control plane");
  }
  if (!agentTransports.some((transport) => transport.id === "http-rpc") || !agentTransports.some((transport) => transport.id === "mcp-stdio")) {
    throw new Error("agent/workbench missing HTTP RPC or MCP transport affordance");
  }
  if (typeof auditStatus.verdict !== "string" || typeof failureSummary.count !== "number") {
    throw new Error("agent/workbench missing compact audit status");
  }
  if (missing) {
    throw new Error(`${missing.source} missing ${missing.kind}: ${missing.ids.join(", ")}`);
  }
  if (unknownWorkbenchActions.length > 0 || unknownWorkbenchLinks.length > 0 || unknownOrientationActions.length > 0 || unknownOrientationLinks.length > 0) {
    throw new Error("agent orientation packet references unknown methods");
  }
  if (vagueInputs.length > 0) {
    throw new Error(`agent orientation packet has vague method inputs: ${vagueInputs.join(", ")}`);
  }
  const invalidActions = invalidAgentActions([...workbenchActions, ...orientationActions]);
  if (invalidActions.length > 0) {
    throw new Error(`agent orientation packet actions missing intent/risk: ${invalidActions.join(", ")}`);
  }
  return {
    workbenchActions: workbenchActions.length,
    workbenchLinks: workbenchLinks.length,
    orientationActions: orientationActions.length,
    orientationLinks: orientationLinks.length,
    unknownWorkbenchActions,
    unknownWorkbenchLinks,
    unknownOrientationActions,
    unknownOrientationLinks,
    vagueInputs,
    agentTransports: agentTransports.length,
    auditVerdict: auditStatus.verdict,
    auditFailureCount: failureSummary.count,
    auditMetadata,
    orientationAuditMetadata
  };
};

const records = (value: unknown) => Array.isArray(value) ? value.map(asRecord) : [];

const unknownMethodReferences = (references: Record<string, unknown>[], methodIds: Set<string>) =>
  references
    .map((reference) => reference.method)
    .filter((method): method is string => typeof method === "string" && !methodIds.has(method));

const invalidAgentActions = (actions: Record<string, unknown>[]) => {
  const validIntents = new Set(["read", "inspect", "execute"]);
  const validRisks = new Set(["none", "low", "medium"]);
  return actions
    .filter((action) => !validIntents.has(String(action.intent)) || !validRisks.has(String(action.risk)))
    .map((action) => String(action.id ?? action.method ?? "unknown"));
};

const invalidInputAffordances = (references: Record<string, unknown>[], methods: PlasticMethod[], source: string) => {
  const methodsById = new Map(methods.map((method) => [method.id, method]));
  return references
    .filter((reference) => {
      const method = typeof reference.method === "string" ? methodsById.get(reference.method) : undefined;
      return method !== undefined
        && schemaHasInputShape(method.inputSchema)
        && !inputSatisfiesRequiredFields(reference.input, method.inputSchema)
        && !schemaHasInputShape(reference.inputSchema);
    })
    .map((reference) => `${source}:${String(reference.id ?? reference.rel ?? reference.method ?? "unknown")}`);
};

const schemaHasInputShape = (schema: unknown) => {
  const record = asRecord(schema);
  return Array.isArray(record.required) && record.required.length > 0
    || Object.keys(asRecord(record.properties)).length > 0;
};

const inputSatisfiesRequiredFields = (input: unknown, schema: unknown) => {
  const required = asRecord(schema).required;
  if (!Array.isArray(required) || required.length === 0) {
    return input !== undefined;
  }
  const inputRecord = asRecord(input);
  return required.every((field) => typeof field === "string" && inputRecord[field] !== undefined);
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};
