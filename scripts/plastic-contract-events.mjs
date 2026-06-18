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
  assert(
    description.examples?.some((example) => example.verifyWith?.method === "events/list" && Array.isArray(example.verifyWith.input?.types)),
    "events/append example must verify through events/list types filter"
  );
  assert(description.effects?.durableEvents?.includes("<input.type>"), "events/append must describe input-defined durable event effects");
  assert(description.effects?.mutatesProjection?.includes("events"), "events/append must describe event projection mutation");
  assert(description.reversibility?.reversible === false, "events/append must describe append-only reversibility");
};

export const assertEventQueryBehavior = async ({ assert, assertArray, createdPanelEvent, itemsFrom, panelId, rpc }) => {
  const events = assertArray(await rpc("events/list", { types: ["panel.created"], scope: { panelId }, limit: 100 }), "events/list is not an array");
  assert(events.length > 0, "events/list returned no events");
  assert(events.every((event) => event.type === "panel.created"), "events/list type filter returned other event types");
  assert(events.every((event) => event.scope?.panelId === panelId), "events/list scope filter returned other panels");
  assert(events.some((event) => event.id === createdPanelEvent.id), "panel create event missing from typed events");
  const limitedEvents = assertArray(await rpc("events/list", { scope: { panelId }, limit: 1 }), "events/list limit result is not an array");
  assert(limitedEvents.length === 1, "events/list limit did not constrain result size");
  const eventsAfterCreate = assertArray(await rpc("events/list", { after: createdPanelEvent.id, scope: { panelId }, limit: "all" }), "events/list after cursor result is not an array");
  assert(!eventsAfterCreate.some((event) => event.id === createdPanelEvent.id), "events/list after cursor included cursor event");
  const beforeCursor = eventsAfterCreate.at(-1)?.id;
  assert(beforeCursor, "event query behavior has no before cursor");
  const eventsBeforeLast = assertArray(await rpc("events/list", { before: beforeCursor, scope: { panelId }, limit: "all" }), "events/list before cursor result is not an array");
  assert(!eventsBeforeLast.some((event) => event.id === beforeCursor), "events/list before cursor included cursor event");
  assert(eventsBeforeLast.some((event) => event.id === createdPanelEvent.id), "events/list before cursor omitted earlier panel event");
  const timeline = await rpc("events/timeline", { scope: { panelId }, limit: 10 });
  const timelineItems = itemsFrom(timeline, "events/timeline returned no items");
  assert(timeline.cursor === timeline.latestEventId, "events/timeline cursor must match latestEventId");
  assert(timelineItems.every((item) => item.scope?.panelId === panelId), "events/timeline scope filter returned other panels");
  assert(timelineItems.some((item) => item.eventId === createdPanelEvent.id), "panel create event missing from timeline");
  const limitedTimeline = await rpc("events/timeline", { scope: { panelId }, limit: 1 });
  assert(itemsFrom(limitedTimeline, "limited events/timeline returned no items").length === 1, "events/timeline limit did not constrain result size");
  const timelineAfterCreate = await rpc("events/timeline", { after: createdPanelEvent.id, scope: { panelId }, limit: 25 });
  const timelineAfterItems = itemsFrom(timelineAfterCreate, "events/timeline after cursor returned no items");
  assert(!timelineAfterItems.some((item) => item.eventId === createdPanelEvent.id), "events/timeline after cursor included cursor event");
  assert(timelineAfterItems.every((item) => item.scope?.panelId === panelId), "events/timeline after cursor returned other panels");
  assert(timelineAfterItems.length === eventsAfterCreate.length, "events/timeline after cursor count diverged from events/list");
  const timelineBeforeLast = await rpc("events/timeline", { before: beforeCursor, scope: { panelId }, limit: 25 });
  const timelineBeforeItems = itemsFrom(timelineBeforeLast, "events/timeline before cursor returned no items");
  assert(!timelineBeforeItems.some((item) => item.eventId === beforeCursor), "events/timeline before cursor included cursor event");
  assert(timelineBeforeItems.length === eventsBeforeLast.length, "events/timeline before cursor count diverged from events/list");
  return { events: events.length, afterCreate: eventsAfterCreate.length, beforeLast: eventsBeforeLast.length, timeline: timelineItems.length, timelineAfterCreate: timelineAfterItems.length, timelineBeforeLast: timelineBeforeItems.length };
};

export const assertSetThemeMethodDescription = ({ assert, description }) => {
  assertPlasticEventSchema({ assert, schema: description.outputSchema, label: "app/setTheme output" });
  assert(description.inputSchema?.properties?.theme?.enum?.includes("light"), "app/setTheme must accept light theme");
  assert(description.inputSchema?.properties?.theme?.enum?.includes("dark"), "app/setTheme must accept dark theme");
  assert(description.effects?.durableEvents?.includes("theme.changed"), "app/setTheme must describe theme.changed events");
  assert(description.effects?.mutatesProjection?.includes("app.theme"), "app/setTheme must describe app.theme projection mutation");
  assert(description.reversibility?.method === "app/setTheme", "app/setTheme must describe its reversal method");
};

export const assertSetThemeBehavior = async ({ assert, rpc }) => {
  const darkEvent = await rpc("app/setTheme", { theme: "dark" });
  assert(darkEvent?.type === "theme.changed", "app/setTheme did not append theme.changed");
  assert(darkEvent.payload?.theme === "dark", "app/setTheme dark payload mismatch");
  assert((await rpc("plastic/state")).app?.theme === "dark", "dark theme did not project into plastic/state");
  const lightEvent = await rpc("app/setTheme", { theme: "light" });
  assert(lightEvent?.type === "theme.changed", "app/setTheme light did not append theme.changed");
  assert(lightEvent.payload?.theme === "light", "app/setTheme light payload mismatch");
  assert((await rpc("plastic/state")).app?.theme === "light", "light theme did not project into plastic/state");
  return { methods: 6, events: [darkEvent.id, lightEvent.id], theme: "light" };
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
