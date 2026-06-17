import {
  assertMatchingModuleInventories,
  assertModuleMethodDiscoveryParity,
  assertRuntimeModuleInventory,
  assertRuntimeStartedModuleInventory
} from "./plastic-contract-helpers.mjs";
import {
  assertModuleAvailabilitySummaries,
  assertRuntimeModuleOrder,
  assertRuntimeModulesMethodDescription
} from "./plastic-module-availability.mjs";

export const assertRuntimeModulesSurface = async ({ assert, methods, rpc }) => {
  const live = await assertRuntimeModuleInventory({ rpc });
  const durable = await assertRuntimeStartedModuleInventory({ rpc });
  assertMatchingModuleInventories({ live, durable });
  assertRuntimeModulesMethodDescription({ assert, description: await rpc("methods/describe", { id: "runtime/modules" }) });
  await assertRuntimeModuleOrder({ assert, modules: live, source: "runtime/modules" });
  await assertRuntimeModuleOrder({ assert, modules: durable, source: "runtime.started modules" });
  assertModuleAvailabilitySummaries({ assert, modules: live, methods, source: "runtime/modules" });
  assertModuleAvailabilitySummaries({ assert, modules: durable, methods, source: "runtime.started modules" });
  await assertModuleMethodDiscoveryParity({ methods, modules: live, rpc });
  return { live, durable };
};
