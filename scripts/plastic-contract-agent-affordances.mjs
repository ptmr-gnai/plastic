export const requiredWorkbenchActions = [
  { id: "read-host", method: "runtime/host" },
  { id: "read-modules", method: "runtime/modules" },
  { id: "run-self-test", method: "plastic/selfTest" },
  { id: "read-audit-status", method: "runtime/auditStatus" },
  { id: "plan-audit-action", method: "runtime/auditActionPlan" },
  { id: "run-audit-action", method: "runtime/runAuditAction" },
  { id: "read-control-plane", method: "events/list", input: { types: ["runtime.started"], limit: 1 } },
  { id: "read-timeline", method: "events/timeline" }
];

export const requiredOrientationActions = [
  { id: "read-host", method: "runtime/host" },
  { id: "run-self-test", method: "plastic/selfTest" },
  { id: "read-audit-status", method: "runtime/auditStatus" },
  { id: "plan-audit-action", method: "runtime/auditActionPlan" },
  { id: "run-audit-action", method: "runtime/runAuditAction" },
  { id: "read-control-plane", method: "events/list", input: { types: ["runtime.started"], limit: 1 } }
];

export const requiredOrientationLinks = [
  { rel: "host", href: "runtime/host", method: "runtime/host" },
  { rel: "self-test", href: "plastic/selfTest", method: "plastic/selfTest" },
  { rel: "audit-status", href: "runtime/auditStatus", method: "runtime/auditStatus" },
  { rel: "audit-action-plan", href: "runtime/auditActionPlan", method: "runtime/auditActionPlan" },
  { rel: "audit-action", href: "runtime/runAuditAction", method: "runtime/runAuditAction" },
  { rel: "modules", href: "runtime/modules", method: "runtime/modules" },
  { rel: "control-plane", href: "events/list", method: "events/list", input: { types: ["runtime.started"], limit: 1 } }
];

export const hasActionAffordance = (actions, expected) =>
  actions?.some((action) =>
    action.id === expected.id
    && action.method === expected.method
    && (expected.input === undefined || JSON.stringify(action.input) === JSON.stringify(expected.input))
  );

export const hasLinkAffordance = (links, expected) =>
  links?.some((link) =>
    link.rel === expected.rel
    && link.href === expected.href
    && link.method === expected.method
    && (expected.input === undefined || JSON.stringify(link.input) === JSON.stringify(expected.input))
  );
