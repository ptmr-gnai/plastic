export const assertPanelMailboxMethodDescriptions = ({ assert, descriptions }) => {
  assertEventOutput({ assert, description: descriptions.send, eventType: "panel.message.sent" });
  assertMessageArray({ assert, schema: descriptions.list.outputSchema, label: "panels/listMessages" });
  assertEventOutput({ assert, description: descriptions.markRead, eventType: "panel.message.read" });
  assertMailboxArray({ assert, schema: descriptions.mailboxes.outputSchema });
};

const assertMessageArray = ({ assert, schema, label }) => {
  assert(schema?.type === "array", `${label} output schema must be an array`);
  const item = schema.items;
  assert(item?.required?.includes("id"), `${label} item schema must require id`);
  assert(item?.required?.includes("fromPanelId"), `${label} item schema must require fromPanelId`);
  assert(item?.required?.includes("toPanelId"), `${label} item schema must require toPanelId`);
  assert(item?.required?.includes("status"), `${label} item schema must require status`);
  assert(item?.properties?.status?.enum?.includes("read"), `${label} item schema must expose read status`);
};

const assertMailboxArray = ({ assert, schema }) => {
  assert(schema?.type === "array", "panels/mailboxes output schema must be an array");
  const item = schema.items;
  assert(item?.required?.includes("panel"), "panels/mailboxes item schema must require panel");
  assert(item?.required?.includes("inboxCount"), "panels/mailboxes item schema must require inboxCount");
  assert(item?.required?.includes("outboxCount"), "panels/mailboxes item schema must require outboxCount");
  assert(item?.required?.includes("unreadCount"), "panels/mailboxes item schema must require unreadCount");
};

const assertEventOutput = ({ assert, description, eventType }) => {
  assert(description.outputSchema?.required?.includes("id"), `${description.id} output schema must require event id`);
  assert(description.outputSchema?.required?.includes("type"), `${description.id} output schema must require event type`);
  assert(description.effects?.durableEvents?.includes(eventType), `${description.id} must describe ${eventType}`);
  assert(description.effects?.mutatesProjection?.includes("panelMessages"), `${description.id} must describe panelMessages projection mutation`);
};
