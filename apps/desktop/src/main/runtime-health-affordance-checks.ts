const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

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
