export type AgentActionIntent = "read" | "inspect" | "execute";
export type AgentActionRisk = "none" | "low" | "medium";

export type AgentActionAffordance = {
  id: string;
  title: string;
  method: string;
  intent: AgentActionIntent;
  risk: AgentActionRisk;
  input?: Record<string, unknown>;
  inputSchema?: unknown;
};

type BaseAction = {
  id: string;
  title: string;
  method: string;
  input?: Record<string, unknown>;
  inputSchema?: unknown;
};

const auditActionInputSchema = { type: "object", required: ["id"], properties: { id: { type: "string" } } };
const timelineInputSchema = { type: "object", properties: { after: { type: "string" }, limit: { type: "number" }, scope: { type: "object" } } };
const panelRenameInputSchema = { type: "object", required: ["id", "title"], properties: { id: { type: "string" }, title: { type: "string" }, subtitle: { type: "string" } } };
const panelMoveInputSchema = { type: "object", required: ["id"], properties: { id: { type: "string" }, windowId: { type: "string" }, order: { type: "number" } } };
const chatSendInputSchema = { type: "object", required: ["chatId", "content"], properties: { chatId: { type: "string" }, content: { type: "string" } } };
const screenshotInputSchema = { type: "object", properties: { windowId: { type: "number" }, ref: { type: "string" } } };

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
  agentAction({ id: "plan-audit-action", title: "Inspect a current runtime audit action", method: "runtime/auditActionPlan", inputSchema: auditActionInputSchema }),
  agentAction({ id: "run-audit-action", title: "Run a current runtime audit action", method: "runtime/runAuditAction", inputSchema: auditActionInputSchema }),
  agentAction({ id: "read-control-plane", title: "Read runtime control plane", method: "events/list", input: { types: ["runtime.started"], limit: 1 } }),
  agentAction({ id: "read-timeline", title: "Read timeline", method: "events/timeline", inputSchema: timelineInputSchema })
];

export const expectedOrientationActions = [
  agentAction({ id: "read-host", title: "Read runtime host", method: "runtime/host" }),
  agentAction({ id: "run-self-test", title: "Run Plastic self-test", method: "plastic/selfTest" }),
  agentAction({ id: "read-audit-status", title: "Read latest runtime audit status", method: "runtime/auditStatus" }),
  agentAction({ id: "plan-audit-action", title: "Inspect a current runtime audit action", method: "runtime/auditActionPlan", inputSchema: auditActionInputSchema }),
  agentAction({ id: "run-audit-action", title: "Run a current runtime audit action", method: "runtime/runAuditAction", inputSchema: auditActionInputSchema }),
  agentAction({ id: "read-control-plane", title: "Read runtime control plane", method: "events/list", input: { types: ["runtime.started"], limit: 1 } }),
  agentAction({ id: "read-timeline", title: "Read recent timeline", method: "events/timeline", inputSchema: timelineInputSchema })
];

export const focusedPanelActions = (input: {
  panelId?: string | undefined;
  panelKind?: string | undefined;
}): AgentActionAffordance[] => {
  if (!input.panelId) {
    return [];
  }

  return [
    agentAction({ id: "read-panel", title: "Read focused panel", method: "panels/get", input: { id: input.panelId } }),
    agentAction({ id: "rename-panel", title: "Rename focused panel", method: "panels/rename", input: { id: input.panelId }, inputSchema: panelRenameInputSchema }),
    agentAction({ id: "move-panel", title: "Move focused panel", method: "panels/move", input: { id: input.panelId }, inputSchema: panelMoveInputSchema }),
    agentAction({ id: "remove-panel", title: "Remove focused panel", method: "panels/remove", input: { id: input.panelId } }),
    ...(input.panelKind === "chat"
      ? [
          agentAction({ id: "read-chat-messages", title: "Read focused chat messages", method: "chats/messages", input: { chatId: input.panelId } }),
          agentAction({ id: "send-chat-message", title: "Send focused chat message", method: "chats/sendToCodex", input: { chatId: input.panelId }, inputSchema: chatSendInputSchema })
        ]
      : [])
  ];
};

export const agentActionSchemas = {
  auditActionInputSchema,
  screenshotInputSchema,
  timelineInputSchema
};
