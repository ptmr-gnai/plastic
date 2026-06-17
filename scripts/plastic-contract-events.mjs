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

export const assertEventsTimelineMethodDescription = ({ assert, description }) => {
  assert(description.outputSchema?.required?.includes("latestEventId"), "events/timeline output schema must require latestEventId");
  assert(description.outputSchema?.required?.includes("eventCount"), "events/timeline output schema must require eventCount");
  assert(description.outputSchema?.required?.includes("cursor"), "events/timeline output schema must require cursor");
  assert(description.outputSchema?.required?.includes("items"), "events/timeline output schema must require items");
  const itemSchema = description.outputSchema?.properties?.items?.items;
  assert(itemSchema?.required?.includes("eventId"), "events/timeline item schema must require eventId");
  assert(itemSchema?.required?.includes("timestamp"), "events/timeline item schema must require timestamp");
  assert(itemSchema?.required?.includes("actor"), "events/timeline item schema must require actor");
  assert(itemSchema?.required?.includes("scope"), "events/timeline item schema must require scope");
  assert(itemSchema?.required?.includes("type"), "events/timeline item schema must require type");
  assert(itemSchema?.required?.includes("summary"), "events/timeline item schema must require summary");
  assert(itemSchema?.required?.includes("links"), "events/timeline item schema must require links");
};
