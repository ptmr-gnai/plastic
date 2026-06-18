export const assertStateMethodDescription = ({ assert, description }) => {
  assert(description.outputSchema?.required?.includes("app"), "plastic/state output schema must require app");
  assert(description.outputSchema?.required?.includes("resources"), "plastic/state output schema must require resources");
  assert(description.outputSchema?.required?.includes("controlPlane"), "plastic/state output schema must require controlPlane");
  assert(description.outputSchema?.properties?.app?.required?.includes("mode"), "plastic/state app schema must require mode");
  assert(description.outputSchema?.properties?.app?.properties?.mode?.enum?.includes("electron"), "plastic/state output schema must expose electron mode");
  assert(description.outputSchema?.properties?.app?.properties?.mode?.enum?.includes("headless"), "plastic/state output schema must expose headless mode");
  assert(description.outputSchema?.properties?.app?.properties?.hostBase?.properties?.id?.enum?.includes("runtime-host-base"), "plastic/state output schema must expose hostBase marker");
  assert(description.outputSchema?.properties?.controlPlane?.required?.includes("runtime"), "plastic/state output schema must expose runtime control plane");
  assert(description.outputSchema?.properties?.controlPlane?.required?.includes("build"), "plastic/state output schema must expose build control plane");
  assert(description.outputSchema?.properties?.controlPlane?.properties?.runtime?.required?.includes("rpcUrl"), "plastic/state output schema must expose runtime RPC URL");
  assert(description.outputSchema?.properties?.controlPlane?.properties?.runtime?.properties?.eventStreamPath?.enum?.includes("/events/stream"), "plastic/state output schema must expose runtime event stream path");
  assert(description.outputSchema?.properties?.controlPlane?.properties?.build?.required?.includes("statusUrl"), "plastic/state output schema must expose build status URL");
  assert(description.outputSchema?.properties?.controlPlane?.properties?.build?.properties?.statusPath?.enum?.includes("/status"), "plastic/state output schema must expose build status path");
};
