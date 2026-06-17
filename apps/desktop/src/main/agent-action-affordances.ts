export type AgentActionIntent = "read" | "inspect" | "execute";
export type AgentActionRisk = "none" | "low" | "medium";

export type AgentActionAffordance = {
  id: string;
  title: string;
  method: string;
  intent: AgentActionIntent;
  risk: AgentActionRisk;
  input?: Record<string, unknown>;
};

type BaseAction = {
  id: string;
  title: string;
  method: string;
  input?: Record<string, unknown>;
};

const inferActionIntent = (action: BaseAction): AgentActionIntent => {
  if (action.id.startsWith("run-") || action.id.startsWith("send-") || action.id.startsWith("capture-")) {
    return "execute";
  }
  if (action.id.startsWith("plan-") || action.id.startsWith("inspect-")) {
    return "inspect";
  }
  return "read";
};

const inferActionRisk = (action: BaseAction, intent: AgentActionIntent): AgentActionRisk => {
  if (action.method === "runtime/runAuditAction" || action.method === "chats/sendToCodex") {
    return "medium";
  }
  if (intent === "execute") {
    return "low";
  }
  return "none";
};

export const agentAction = (action: BaseAction): AgentActionAffordance => {
  const intent = inferActionIntent(action);
  return {
    ...action,
    intent,
    risk: inferActionRisk(action, intent)
  };
};

export const expectedWorkbenchActions = [
  agentAction({ id: "read-host", title: "Read runtime host", method: "runtime/host" }),
  agentAction({ id: "read-modules", title: "Read runtime modules", method: "runtime/modules" }),
  agentAction({ id: "run-self-test", title: "Run Plastic self-test", method: "plastic/selfTest" }),
  agentAction({ id: "read-audit-status", title: "Read latest runtime audit status", method: "runtime/auditStatus" }),
  agentAction({ id: "plan-audit-action", title: "Inspect a current runtime audit action", method: "runtime/auditActionPlan" }),
  agentAction({ id: "run-audit-action", title: "Run a current runtime audit action", method: "runtime/runAuditAction" }),
  agentAction({ id: "read-control-plane", title: "Read runtime control plane", method: "events/list", input: { types: ["runtime.started"], limit: 1 } }),
  agentAction({ id: "read-timeline", title: "Read timeline", method: "events/timeline" })
];

export const expectedOrientationActions = [
  agentAction({ id: "read-host", title: "Read runtime host", method: "runtime/host" }),
  agentAction({ id: "run-self-test", title: "Run Plastic self-test", method: "plastic/selfTest" }),
  agentAction({ id: "read-audit-status", title: "Read latest runtime audit status", method: "runtime/auditStatus" }),
  agentAction({ id: "plan-audit-action", title: "Inspect a current runtime audit action", method: "runtime/auditActionPlan" }),
  agentAction({ id: "run-audit-action", title: "Run a current runtime audit action", method: "runtime/runAuditAction" }),
  agentAction({ id: "read-control-plane", title: "Read runtime control plane", method: "events/list", input: { types: ["runtime.started"], limit: 1 } }),
  agentAction({ id: "read-timeline", title: "Read recent timeline", method: "events/timeline" })
];
