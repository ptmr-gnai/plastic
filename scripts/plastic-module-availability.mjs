export const expectedRuntimeModuleIds = [
  "runtime-state",
  "runtime-snapshot",
  "agent-workbench",
  "agent-orient",
  "runtime-build",
  "runtime-diagnostics",
  "extension-authoring",
  "renderer-control",
  "agent-backend",
  "runtime-control",
  "panel-control",
  "window-capability",
  "deixis",
  "runtime-health",
  "extension-runtime",
  "panel-mailbox",
  "runtime-modules"
];

export const assertRuntimeModuleOrder = ({ assert, modules, source }) => {
  assert(
    JSON.stringify(modules.ids) === JSON.stringify(expectedRuntimeModuleIds),
    `${source} module order diverged from shared runtime plan`
  );
  for (const [index, module] of modules.items.entries()) {
    assert(module.order === index, `${source} ${module.id} order field does not match list index`);
  }
};

export const assertModuleAvailabilitySummaries = ({ assert, modules, methods, source }) => {
  const byMethodId = Object.fromEntries(methods.map((method) => [method.id, method]));
  for (const module of modules.items) {
    const expected = summarizeModuleAvailability(module.methodIds ?? [], byMethodId);
    assert(JSON.stringify(module.availability) === JSON.stringify(expected), `${source} ${module.id} availability summary mismatch`);
  }
};

export const summarizeModuleAvailability = (methodIds, byMethodId) => {
  const requiredCapabilities = new Set();
  const missingCapabilities = new Set();
  const counts = { available: 0, degraded: 0, unavailable: 0 };
  for (const id of methodIds) {
    const availability = byMethodId[id]?.availability;
    const status = availability?.status ?? "unavailable";
    counts[status] += 1;
    for (const capability of availability?.requiredCapabilities ?? []) {
      requiredCapabilities.add(capability);
    }
    for (const capability of availability?.missingCapabilities ?? []) {
      missingCapabilities.add(capability);
    }
  }
  return {
    ...counts,
    requiredCapabilities: [...requiredCapabilities].sort(),
    missingCapabilities: [...missingCapabilities].sort()
  };
};
