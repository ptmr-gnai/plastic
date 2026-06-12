import type { RuntimeCapability } from "./runtime-method-context.js";

export const capabilityStatusSummary = (capabilities: RuntimeCapability[]) =>
  Object.fromEntries(capabilities.map((capability) => [capability.id, capability.status]));
