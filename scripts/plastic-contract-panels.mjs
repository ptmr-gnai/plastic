export const assertPanelControlMethodDescriptions = ({ assert, descriptions }) => {
  assertPanelSchema({ assert, schema: descriptions.list.outputSchema?.items, label: "panels/list item" });
  assertPanelSchema({ assert, schema: descriptions.get.outputSchema, label: "panels/get output" });
  assertEventOutput({ assert, description: descriptions.create, eventType: "panel.created", projection: "panels" });
  assertEventOutput({ assert, description: descriptions.rename, eventType: "panel.renamed", projection: "panels" });
  assertEventOutput({ assert, description: descriptions.move, eventType: "panel.moved", projection: "windows" });
  assertEventOutput({ assert, description: descriptions.close, eventType: "panel.removed", projection: "windows" });
};

const assertPanelSchema = ({ assert, schema, label }) => {
  assert(schema?.required?.includes("id"), `${label} schema must require id`);
  assert(schema?.required?.includes("title"), `${label} schema must require title`);
  assert(schema?.required?.includes("kind"), `${label} schema must require kind`);
  assert(schema?.required?.includes("extensionId"), `${label} schema must require extensionId`);
  assert(schema?.required?.includes("order"), `${label} schema must require order`);
  assert(schema?.properties?.windowId?.type === "string", `${label} schema must expose windowId`);
};

const assertEventOutput = ({ assert, description, eventType, projection }) => {
  assert(description.outputSchema?.required?.includes("id"), `${description.id} output schema must require event id`);
  assert(description.outputSchema?.required?.includes("type"), `${description.id} output schema must require event type`);
  assert(description.effects?.durableEvents?.includes(eventType), `${description.id} must describe ${eventType}`);
  assert(description.effects?.mutatesProjection?.includes(projection), `${description.id} must describe ${projection} projection mutation`);
};
