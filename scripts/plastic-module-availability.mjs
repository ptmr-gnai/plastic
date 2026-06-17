const fallbackRuntimeModuleIds = [
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
  "runtime-host",
  "runtime-modules"
];

let runtimeModuleIdsPromise;

export const expectedRuntimeModuleIds = async () => {
  if (!runtimeModuleIdsPromise) {
    runtimeModuleIdsPromise = import("../apps/desktop/dist-electron/main/runtime-module-ids.js")
      .then((module) => module.standardRuntimeModuleIds ?? fallbackRuntimeModuleIds)
      .catch(() => fallbackRuntimeModuleIds);
  }
  return runtimeModuleIdsPromise;
};

export const assertRuntimeModuleOrder = async ({ assert, modules, source }) => {
  const expectedIds = await expectedRuntimeModuleIds();
  assert(
    JSON.stringify(modules.ids) === JSON.stringify(expectedIds),
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

export const assertRuntimeModulesMethodDescription = ({ assert, description }) => {
  assert(description.outputSchema?.required?.includes("count"), "runtime/modules output schema must require count");
  assert(description.outputSchema?.required?.includes("items"), "runtime/modules output schema must require items");
  const itemSchema = description.outputSchema?.properties?.items?.items;
  assert(itemSchema?.required?.includes("id"), "runtime/modules item schema must require id");
  assert(itemSchema?.required?.includes("order"), "runtime/modules item schema must require order");
  assert(itemSchema?.required?.includes("methodIds"), "runtime/modules item schema must require methodIds");
  assert(itemSchema?.required?.includes("availability"), "runtime/modules item schema must require availability");
  const availabilitySchema = itemSchema?.properties?.availability;
  assert(availabilitySchema?.required?.includes("available"), "runtime/modules availability schema must require available");
  assert(availabilitySchema?.required?.includes("degraded"), "runtime/modules availability schema must require degraded");
  assert(availabilitySchema?.required?.includes("unavailable"), "runtime/modules availability schema must require unavailable");
  assert(availabilitySchema?.required?.includes("requiredCapabilities"), "runtime/modules availability schema must require requiredCapabilities");
  assert(availabilitySchema?.required?.includes("missingCapabilities"), "runtime/modules availability schema must require missingCapabilities");
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
