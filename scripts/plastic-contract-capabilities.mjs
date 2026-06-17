export const assertRuntimeCapabilitiesMethodDescription = ({ assert, description }) => {
  assert(description.availability?.status === "available", "runtime/capabilities availability mismatch");
  assert(description.outputSchema?.required?.includes("count"), "runtime/capabilities output schema must require count");
  assert(description.outputSchema?.required?.includes("items"), "runtime/capabilities output schema must require items");
  assert(description.outputSchema?.properties?.items?.items?.required?.includes("id"), "runtime/capabilities item schema must require id");
  assert(description.outputSchema?.properties?.items?.items?.required?.includes("title"), "runtime/capabilities item schema must require title");
  assert(description.outputSchema?.properties?.items?.items?.required?.includes("status"), "runtime/capabilities item schema must require status");
  assert(description.outputSchema?.properties?.items?.items?.properties?.status?.enum?.includes("available"), "runtime/capabilities item schema must expose available status");
  assert(description.outputSchema?.properties?.items?.items?.properties?.status?.enum?.includes("degraded"), "runtime/capabilities item schema must expose degraded status");
  assert(description.outputSchema?.properties?.items?.items?.properties?.status?.enum?.includes("unavailable"), "runtime/capabilities item schema must expose unavailable status");
};
