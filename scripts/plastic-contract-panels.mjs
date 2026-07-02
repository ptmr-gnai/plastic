export const assertPanelControlMethodDescriptions = ({ assert, descriptions }) => {
  assert(descriptions.list.inputSchema?.type === "object", "panels/list input schema must be object");
  assertPanelSchema({ assert, schema: descriptions.list.outputSchema?.items, label: "panels/list item" });
  assert(descriptions.list.effects?.durableEvents?.length === 0, "panels/list must describe no durable events");
  assert(descriptions.list.reversibility?.reversible === true, "panels/list must be read-only reversible");
  assertPanelSchema({ assert, schema: descriptions.get.outputSchema, label: "panels/get output" });
  assertEventOutput({ assert, description: descriptions.create, eventType: "panel.created", projections: ["panels", "windows"] });
  assertEventOutput({ assert, description: descriptions.rename, eventType: "panel.renamed", projections: ["panels"] });
  assertEventOutput({ assert, description: descriptions.move, eventType: "panel.moved", projections: ["panels", "windows"] });
  assertEventOutput({ assert, description: descriptions.remove, eventType: "panel.removed", projections: ["panels", "windows"] });
  assertEventOutput({ assert, description: descriptions.close, eventType: "panel.removed", projections: ["panels", "windows"] });
};

export const assertPanelLifecycleEventContracts = ({ assert, events, panelId }) => {
  const byType = Object.fromEntries(events.map((event) => [event.type, event]));
  const created = byType["panel.created"];
  const renamed = byType["panel.renamed"];
  const moved = byType["panel.moved"];
  const removed = byType["panel.removed"];
  assert(created?.payload?.id === panelId, "panel.created payload id mismatch");
  assert(created.payload.title === "Contract Panel", "panel.created payload title mismatch");
  assert(created.payload.kind === "generic", "panel.created payload kind mismatch");
  assert(created.payload.order === 10, "panel.created payload order mismatch");
  assert(renamed?.payload?.id === panelId, "panel.renamed payload id mismatch");
  assert(renamed.payload.title === "Contract Panel Renamed", "panel.renamed payload title mismatch");
  assert(moved?.payload?.id === panelId, "panel.moved payload id mismatch");
  assert(moved.payload.order === 1, "panel.moved payload order mismatch");
  assert(removed?.payload?.id === panelId, "panel.removed payload id mismatch");
  assert(removed.payload.reason === "closed", "panel.removed payload reason mismatch");
  assert(events.every((event) => event.scope?.panelId === panelId), "panel lifecycle event scope mismatch");
};

const assertPanelSchema = ({ assert, schema, label }) => {
  assert(schema?.required?.includes("id"), `${label} schema must require id`);
  assert(schema?.required?.includes("title"), `${label} schema must require title`);
  assert(schema?.required?.includes("kind"), `${label} schema must require kind`);
  assert(schema?.required?.includes("extensionId"), `${label} schema must require extensionId`);
  assert(schema?.required?.includes("order"), `${label} schema must require order`);
  assert(schema?.properties?.windowId?.type === "string", `${label} schema must expose windowId`);
};

const assertEventOutput = ({ assert, description, eventType, projections }) => {
  assert(description.outputSchema?.required?.includes("id"), `${description.id} output schema must require event id`);
  assert(description.outputSchema?.required?.includes("type"), `${description.id} output schema must require event type`);
  assert(description.effects?.durableEvents?.includes(eventType), `${description.id} must describe ${eventType}`);
  for (const projection of projections) {
    assert(description.effects?.mutatesProjection?.includes(projection), `${description.id} must describe ${projection} projection mutation`);
  }
};
