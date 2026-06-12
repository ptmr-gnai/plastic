export const hasServiceAffordance = (resource, expected) =>
  resource.links?.some((link) =>
    link.rel === expected.rel && link.href === expected.href && link.method === expected.method
  )
  && resource.actions?.some((action) =>
    action.id === expected.actionId && action.method === expected.method
  );
