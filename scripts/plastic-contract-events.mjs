export const assertEventsListMethodDescription = ({ assert, description }) => {
  assert(description.outputSchema?.type === "array", "events/list output schema must be an array");
  assertPlasticEventSchema({ assert, schema: description.outputSchema?.items, label: "events/list event" });
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

export const assertEventsAppendMethodDescription = ({ assert, description }) => {
  assertPlasticEventSchema({ assert, schema: description.outputSchema, label: "events/append output" });
  assert(description.effects?.durableEvents?.includes("<input.type>"), "events/append must describe input-defined durable event effects");
  assert(description.effects?.mutatesProjection?.includes("events"), "events/append must describe event projection mutation");
  assert(description.reversibility?.reversible === false, "events/append must describe append-only reversibility");
};

const assertPlasticEventSchema = ({ assert, schema, label }) => {
  assert(schema?.required?.includes("id"), `${label} schema must require id`);
  assert(schema?.required?.includes("type"), `${label} schema must require type`);
  assert(schema?.required?.includes("timestamp"), `${label} schema must require timestamp`);
  assert(schema?.required?.includes("actor"), `${label} schema must require actor`);
  assert(schema?.required?.includes("scope"), `${label} schema must require scope`);
  assert(schema?.required?.includes("payload"), `${label} schema must require payload`);
  assert(schema?.required?.includes("meta"), `${label} schema must require meta`);
  assert(schema?.properties?.actor?.required?.includes("kind"), `${label} actor schema must require kind`);
  assert(schema?.properties?.actor?.properties?.kind?.enum?.includes("agent"), `${label} actor schema must expose agent actors`);
  assert(schema?.properties?.scope?.required?.includes("workspaceId"), `${label} scope schema must require workspaceId`);
};
