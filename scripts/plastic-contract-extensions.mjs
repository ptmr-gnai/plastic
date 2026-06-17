export const assertExtensionQueryMethodDescriptions = ({ assert, descriptions }) => {
  assertExtensionSchema({ assert, schema: descriptions.list.outputSchema?.items, label: "extensions/list item" });
  assertExtensionSchema({ assert, schema: descriptions.get.outputSchema, label: "extensions/get output" });
  assert(descriptions.scan.outputSchema?.required?.includes("discovered"), "extensions/scan output schema must require discovered");
  assert(descriptions.scan.outputSchema?.required?.includes("events"), "extensions/scan output schema must require events");
  assertExtensionSchema({ assert, schema: descriptions.scan.outputSchema?.properties?.discovered?.items, label: "extensions/scan discovered item" });
  assert(descriptions.scan.outputSchema?.properties?.events?.items?.required?.includes("id"), "extensions/scan event schema must expose event id");
  assert(descriptions.scan.effects?.durableEvents?.includes("extension.discovered"), "extensions/scan must describe discovery events");
};

export const assertExtensionLifecycleMethodDescriptions = ({ assert, descriptions }) => {
  assert(descriptions.activate.outputSchema?.required?.includes("activated"), "extensions/activate output schema must require activated");
  assert(descriptions.activate.outputSchema?.required?.includes("skipped"), "extensions/activate output schema must require skipped");
  assert(descriptions.activate.outputSchema?.required?.includes("failed"), "extensions/activate output schema must require failed");
  assert(descriptions.activate.effects?.durableEvents?.includes("extension.loaded"), "extensions/activate must describe loaded events");
  assert(descriptions.registerPanel.outputSchema?.required?.includes("id"), "extensions/registerPanel output schema must expose event id");
  assert(descriptions.registerPanel.effects?.durableEvents?.includes("panel.created"), "extensions/registerPanel must describe panel.created");
  assertExtensionSchema({ assert, schema: descriptions.forkBundled.outputSchema?.properties?.source, label: "extensions/forkBundled source" });
  assertExtensionSchema({ assert, schema: descriptions.forkBundled.outputSchema?.properties?.fork, label: "extensions/forkBundled fork" });
  assert(descriptions.forkBundled.outputSchema?.required?.includes("targetPath"), "extensions/forkBundled output schema must require targetPath");
  assert(descriptions.forkBundled.outputSchema?.properties?.events?.items?.required?.includes("id"), "extensions/forkBundled event schema must expose event id");
};

const assertExtensionSchema = ({ assert, schema, label }) => {
  assert(schema?.required?.includes("id"), `${label} schema must require id`);
  assert(schema?.required?.includes("title"), `${label} schema must require title`);
  assert(schema?.required?.includes("source"), `${label} schema must require source`);
  assert(schema?.required?.includes("panels"), `${label} schema must require panels`);
  assert(schema?.required?.includes("renderers"), `${label} schema must require renderers`);
  assert(schema?.required?.includes("methods"), `${label} schema must require methods`);
  assert(schema?.required?.includes("errors"), `${label} schema must require errors`);
  assert(schema?.properties?.source?.enum?.includes("bundled"), `${label} schema must expose bundled source`);
  assert(schema?.properties?.source?.enum?.includes("workspace"), `${label} schema must expose workspace source`);
};
