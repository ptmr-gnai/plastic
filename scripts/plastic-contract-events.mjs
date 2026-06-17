export const assertEventsListMethodDescription = ({ assert, description }) => {
  assert(description.outputSchema?.type === "array", "events/list output schema must be an array");
  const itemSchema = description.outputSchema?.items;
  assert(itemSchema?.required?.includes("id"), "events/list event schema must require id");
  assert(itemSchema?.required?.includes("type"), "events/list event schema must require type");
  assert(itemSchema?.required?.includes("timestamp"), "events/list event schema must require timestamp");
  assert(itemSchema?.required?.includes("actor"), "events/list event schema must require actor");
  assert(itemSchema?.required?.includes("scope"), "events/list event schema must require scope");
  assert(itemSchema?.required?.includes("payload"), "events/list event schema must require payload");
  assert(itemSchema?.required?.includes("meta"), "events/list event schema must require meta");
  assert(itemSchema?.properties?.actor?.required?.includes("kind"), "events/list actor schema must require kind");
  assert(itemSchema?.properties?.actor?.properties?.kind?.enum?.includes("agent"), "events/list actor schema must expose agent actors");
  assert(itemSchema?.properties?.scope?.required?.includes("workspaceId"), "events/list scope schema must require workspaceId");
};
