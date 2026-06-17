export const assertAppDiagnosticsMethodDescription = ({ assert, description }) => {
  assert(description.outputSchema?.required?.includes("mode"), "app/diagnostics output schema must require mode");
  assert(description.outputSchema?.required?.includes("workspaceDir"), "app/diagnostics output schema must require workspaceDir");
  assert(description.outputSchema?.required?.includes("eventPath"), "app/diagnostics output schema must require eventPath");
  assert(description.outputSchema?.required?.includes("hostBase"), "app/diagnostics output schema must require hostBase");
  assert(description.outputSchema?.required?.includes("windowCount"), "app/diagnostics output schema must require windowCount");
  assert(description.outputSchema?.properties?.mode?.enum?.includes("electron"), "app/diagnostics output schema must expose electron mode");
  assert(description.outputSchema?.properties?.mode?.enum?.includes("headless"), "app/diagnostics output schema must expose headless mode");
  assert(description.outputSchema?.properties?.hostBase?.properties?.id?.enum?.includes("runtime-host-base"), "app/diagnostics output schema must expose hostBase marker");
};
