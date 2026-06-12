const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

export const expectedSnapshotLinks = [
  { rel: "host", href: "runtime/host", method: "runtime/host" },
  { rel: "capabilities", href: "runtime/capabilities", method: "runtime/capabilities" },
  { rel: "control-plane", href: "events/list", method: "events/list", input: { types: ["runtime.started"], limit: 1 } },
  { rel: "self-test", href: "plastic/selfTest", method: "plastic/selfTest" }
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
