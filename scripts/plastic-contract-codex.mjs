export const assertCodexCoreMethodDescriptions = ({ assert, descriptions }) => {
  assert(descriptions.status.outputSchema?.required?.includes("connected"), "codex/status output schema must require connected");
  assert(descriptions.status.outputSchema?.required?.includes("initialized"), "codex/status output schema must require initialized");
  assert(descriptions.status.outputSchema?.required?.includes("pendingRequests"), "codex/status output schema must require pendingRequests");
  assert(descriptions.defaults.outputSchema?.required?.includes("model"), "codex/defaults output schema must require model");
  assert(descriptions.setDefaults.outputSchema?.required?.includes("defaults"), "codex/setDefaults output schema must require defaults");
  assert(descriptions.setDefaults.outputSchema?.required?.includes("eventId"), "codex/setDefaults output schema must require eventId");
  assert(descriptions.setDefaults.effects?.durableEvents?.includes("codex.defaults.updated"), "codex/setDefaults must describe defaults update events");
  assert(descriptions.request.outputSchema?.description?.includes("delegated Codex"), "codex/request output schema must describe delegated Codex result");
  assert(descriptions.threadStart.outputSchema?.description?.includes("delegated Codex"), "codex/threadStart output schema must describe delegated Codex result");
  assert(descriptions.turnStart.outputSchema?.description?.includes("delegated Codex"), "codex/turnStart output schema must describe delegated Codex result");
  assert(descriptions.modelList.outputSchema?.description?.includes("delegated Codex"), "codex/modelList output schema must describe delegated Codex result");
};

export const assertCodexBridgeMethodDescriptions = ({ assert, descriptions }) => {
  assert(descriptions.configure.outputSchema?.required?.includes("configured"), "bridge/configurePlasticMcp output schema must require configured");
  assert(descriptions.configure.outputSchema?.required?.includes("value"), "bridge/configurePlasticMcp output schema must require value");
  assert(descriptions.status.outputSchema?.required?.includes("plasticMcpConfigured"), "bridge/status output schema must require plasticMcpConfigured");
  assert(descriptions.status.outputSchema?.required?.includes("runtimeRpcUrl"), "bridge/status output schema must require runtimeRpcUrl");
  assert(descriptions.test.outputSchema?.required?.includes("ok"), "bridge/test output schema must require ok");
  assert(descriptions.test.outputSchema?.required?.includes("eventId"), "bridge/test output schema must require eventId");
  assert(descriptions.call.outputSchema?.required?.includes("threadId"), "bridge/callPlasticRpcTool output schema must require threadId");
  assert(descriptions.call.outputSchema?.required?.includes("result"), "bridge/callPlasticRpcTool output schema must require result");
  assert(descriptions.call.outputSchema?.required?.includes("eventId"), "bridge/callPlasticRpcTool output schema must require eventId");
};
