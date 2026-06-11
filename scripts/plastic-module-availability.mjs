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
