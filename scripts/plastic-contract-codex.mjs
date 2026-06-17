export const assertCodexCoreMethodDescriptions = ({ assert, descriptions }) => {
  assert(descriptions.status.outputSchema?.required?.includes("connected"), "codex/status output schema must require connected");
  assert(descriptions.status.outputSchema?.required?.includes("initialized"), "codex/status output schema must require initialized");
  assert(descriptions.status.outputSchema?.required?.includes("pendingRequests"), "codex/status output schema must require pendingRequests");
  assert(descriptions.defaults.outputSchema?.required?.includes("model"), "codex/defaults output schema must require model");
  assert(descriptions.setDefaults.outputSchema?.required?.includes("defaults"), "codex/setDefaults output schema must require defaults");
  assert(descriptions.setDefaults.outputSchema?.required?.includes("eventId"), "codex/setDefaults output schema must require eventId");
  assert(descriptions.setDefaults.effects?.durableEvents?.includes("codex.defaults.updated"), "codex/setDefaults must describe defaults update events");
};
