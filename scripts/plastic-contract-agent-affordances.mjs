const fallbackWorkbenchActions = [
  { id: "read-host", method: "runtime/host", intent: "read", risk: "none" },
  { id: "read-modules", method: "runtime/modules", intent: "read", risk: "none" },
  { id: "run-self-test", method: "plastic/selfTest", intent: "execute", risk: "low" },
  { id: "read-audit-status", method: "runtime/auditStatus", intent: "read", risk: "none" },
  { id: "plan-audit-action", method: "runtime/auditActionPlan", intent: "inspect", risk: "none" },
  { id: "run-audit-action", method: "runtime/runAuditAction", intent: "execute", risk: "medium" },
  { id: "read-control-plane", method: "events/list", intent: "read", risk: "none", input: { types: ["runtime.started"], limit: 1 } },
  { id: "read-timeline", method: "events/timeline", intent: "read", risk: "none" }
];

const fallbackOrientationActions = [
  { id: "read-host", method: "runtime/host", intent: "read", risk: "none" },
  { id: "run-self-test", method: "plastic/selfTest", intent: "execute", risk: "low" },
  { id: "read-audit-status", method: "runtime/auditStatus", intent: "read", risk: "none" },
  { id: "plan-audit-action", method: "runtime/auditActionPlan", intent: "inspect", risk: "none" },
  { id: "run-audit-action", method: "runtime/runAuditAction", intent: "execute", risk: "medium" },
  { id: "read-control-plane", method: "events/list", intent: "read", risk: "none", input: { types: ["runtime.started"], limit: 1 } },
  { id: "read-timeline", method: "events/timeline", intent: "read", risk: "none" }
];

const fallbackOrientationLinks = [
  { rel: "host", href: "runtime/host", method: "runtime/host" },
  { rel: "self-test", href: "plastic/selfTest", method: "plastic/selfTest" },
  { rel: "audit-status", href: "runtime/auditStatus", method: "runtime/auditStatus" },
  { rel: "audit-action-plan", href: "runtime/auditActionPlan", method: "runtime/auditActionPlan" },
  { rel: "audit-action", href: "runtime/runAuditAction", method: "runtime/runAuditAction" },
  { rel: "modules", href: "runtime/modules", method: "runtime/modules" },
  { rel: "control-plane", href: "events/list", method: "events/list", input: { types: ["runtime.started"], limit: 1 } }
];

const runtimeAffordances = await import("../apps/desktop/dist-electron/main/runtime-health-affordance-checks.js").catch(() => ({}));

export const requiredWorkbenchActions = runtimeAffordances.expectedWorkbenchActions ?? fallbackWorkbenchActions;
export const requiredOrientationActions = runtimeAffordances.expectedOrientationActions ?? fallbackOrientationActions;
export const requiredOrientationLinks = runtimeAffordances.expectedOrientationLinks ?? fallbackOrientationLinks;

export const hasActionAffordance = (actions, expected) =>
  actions?.some((action) =>
    action.id === expected.id
    && action.method === expected.method
    && (expected.intent === undefined || action.intent === expected.intent)
    && (expected.risk === undefined || action.risk === expected.risk)
    && (expected.input === undefined || JSON.stringify(action.input) === JSON.stringify(expected.input))
  );

export const hasLinkAffordance = (links, expected) =>
  links?.some((link) =>
    link.rel === expected.rel
    && link.href === expected.href
    && link.method === expected.method
    && (expected.input === undefined || JSON.stringify(link.input) === JSON.stringify(expected.input))
  );
