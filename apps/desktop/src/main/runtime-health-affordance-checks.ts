const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

export const expectedSnapshotLinks = [
  { rel: "host", href: "runtime/host", method: "runtime/host" },
  { rel: "capabilities", href: "runtime/capabilities", method: "runtime/capabilities" },
  { rel: "control-plane", href: "events/list", method: "events/list", input: { types: ["runtime.started"], limit: 1 } },
  { rel: "self-test", href: "plastic/selfTest", method: "plastic/selfTest" }
];

export const expectedWorkbenchActions = [
  { id: "read-host", method: "runtime/host" },
  { id: "read-modules", method: "runtime/modules" },
  { id: "run-self-test", method: "plastic/selfTest" },
  { id: "read-audit-status", method: "runtime/auditStatus" },
  { id: "plan-audit-action", method: "runtime/auditActionPlan" },
  { id: "run-audit-action", method: "runtime/runAuditAction" },
  { id: "read-control-plane", method: "events/list", input: { types: ["runtime.started"], limit: 1 } },
  { id: "read-timeline", method: "events/timeline" }
];

export const expectedOrientationActions = [
  { id: "read-host", method: "runtime/host" },
  { id: "run-self-test", method: "plastic/selfTest" },
  { id: "read-audit-status", method: "runtime/auditStatus" },
  { id: "plan-audit-action", method: "runtime/auditActionPlan" },
  { id: "run-audit-action", method: "runtime/runAuditAction" },
  { id: "read-control-plane", method: "events/list", input: { types: ["runtime.started"], limit: 1 } },
  { id: "read-timeline", method: "events/timeline" }
];

export const expectedOrientationLinks = [
  { rel: "host", href: "runtime/host", method: "runtime/host" },
  { rel: "modules", href: "runtime/modules", method: "runtime/modules" },
  { rel: "self-test", href: "plastic/selfTest", method: "plastic/selfTest" },
  { rel: "audit-status", href: "runtime/auditStatus", method: "runtime/auditStatus" },
  { rel: "audit-action-plan", href: "runtime/auditActionPlan", method: "runtime/auditActionPlan" },
  { rel: "audit-action", href: "runtime/runAuditAction", method: "runtime/runAuditAction" },
  { rel: "control-plane", href: "events/list", method: "events/list", input: { types: ["runtime.started"], limit: 1 } }
];

export const hasServiceAffordance = (
  resource: Record<string, unknown>,
  expected: { rel: string; href: string; method: string; actionId: string }
) =>
  (Array.isArray(resource.links) ? resource.links.map(asRecord) : []).some((link) =>
    link.rel === expected.rel && link.href === expected.href && link.method === expected.method
  )
  && (Array.isArray(resource.actions) ? resource.actions.map(asRecord) : []).some((action) =>
    action.id === expected.actionId && action.method === expected.method
  );

export const hasLinkAffordance = (
  links: Record<string, unknown>[],
  expected: { rel: string; href: string; method: string; input?: unknown }
) =>
  links.some((link) =>
    link.rel === expected.rel
    && link.href === expected.href
    && link.method === expected.method
    && (expected.input === undefined || JSON.stringify(link.input) === JSON.stringify(expected.input))
  );

export const hasActionAffordance = (
  actions: Record<string, unknown>[],
  expected: { id: string; method: string; input?: unknown }
) =>
  actions.some((action) =>
    action.id === expected.id
    && action.method === expected.method
    && (expected.input === undefined || JSON.stringify(action.input) === JSON.stringify(expected.input))
  );
