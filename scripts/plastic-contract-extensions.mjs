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
  assert(descriptions.scaffold.outputSchema?.required?.includes("extensionId"), "extensions/scaffold output schema must require extensionId");
  assert(descriptions.scaffold.outputSchema?.required?.includes("manifestPath"), "extensions/scaffold output schema must require manifestPath");
  assert(descriptions.scaffold.outputSchema?.required?.includes("eventId"), "extensions/scaffold output schema must require eventId");
  assert(descriptions.scaffold.effects?.durableEvents?.includes("extension.scaffolded"), "extensions/scaffold must describe scaffolded events");
  assert(descriptions.activate.outputSchema?.required?.includes("activated"), "extensions/activate output schema must require activated");
  assert(descriptions.activate.outputSchema?.required?.includes("skipped"), "extensions/activate output schema must require skipped");
  assert(descriptions.activate.outputSchema?.required?.includes("failed"), "extensions/activate output schema must require failed");
  assert(descriptions.activate.outputSchema?.properties?.activated?.items?.required?.includes("eventId"), "extensions/activate activated item schema must require eventId");
  assert(descriptions.activate.outputSchema?.properties?.skipped?.items?.required?.includes("reason"), "extensions/activate skipped item schema must require reason");
  assert(descriptions.activate.outputSchema?.properties?.failed?.items?.required?.includes("error"), "extensions/activate failed item schema must require error");
  assert(descriptions.activate.effects?.durableEvents?.includes("extension.loaded"), "extensions/activate must describe loaded events");
  assert(descriptions.registerPanel.outputSchema?.required?.includes("id"), "extensions/registerPanel output schema must expose event id");
  assert(descriptions.registerPanel.effects?.durableEvents?.includes("panel.created"), "extensions/registerPanel must describe panel.created");
  assertExtensionSchema({ assert, schema: descriptions.forkBundled.outputSchema?.properties?.source, label: "extensions/forkBundled source" });
  assertExtensionSchema({ assert, schema: descriptions.forkBundled.outputSchema?.properties?.fork, label: "extensions/forkBundled fork" });
  assert(descriptions.forkBundled.outputSchema?.required?.includes("targetPath"), "extensions/forkBundled output schema must require targetPath");
  assert(descriptions.forkBundled.outputSchema?.properties?.events?.items?.required?.includes("id"), "extensions/forkBundled event schema must expose event id");
};

export const assertExtensionScaffoldEventContracts = ({ assert, discoveredEvents, scaffold, scaffoldEvents }) => {
  const scaffolded = scaffoldEvents.find((event) => event.id === scaffold.eventId) ?? scaffoldEvents[0];
  const discovered = discoveredEvents.find((event) => event.payload?.id === scaffold.extensionId);
  assert(scaffolded?.payload?.id === scaffold.extensionId, "extension.scaffolded payload id mismatch");
  assert(scaffolded.payload.title === "Contract Extension", "extension.scaffolded payload title mismatch");
  assert(scaffolded.payload.panelId === scaffold.panelId, "extension.scaffolded payload panelId mismatch");
  assert(scaffolded.payload.extensionDir === scaffold.extensionDir, "extension.scaffolded payload extensionDir mismatch");
  assert(scaffolded.payload.manifestPath === scaffold.manifestPath, "extension.scaffolded payload manifestPath mismatch");
  assert(scaffolded.scope?.extensionId === scaffold.extensionId, "extension.scaffolded scope mismatch");
  assert(discovered?.payload?.id === scaffold.extensionId, "extension.discovered payload id mismatch");
  assert(discovered.payload.title === "Contract Extension", "extension.discovered payload title mismatch");
  assert(discovered.payload.source === "workspace", "extension.discovered payload source mismatch");
  assert(discovered.payload.manifest?.panels?.some((panel) => panel.id === scaffold.panelId), "extension.discovered manifest missing scaffold panel");
  assert(discovered.scope?.extensionId === scaffold.extensionId, "extension.discovered scope mismatch");
};

export const assertExtensionRemovedEventContract = ({ assert, events, extensionId }) => {
  const removed = events.find((event) => event.payload?.id === extensionId);
  assert(removed?.payload?.reason === "not found during scan", "extension.removed payload reason mismatch");
  assert(removed.scope?.extensionId === extensionId, "extension.removed scope mismatch");
};

export const assertExtensionVerificationMethodDescriptions = ({ assert, descriptions }) => {
  assertVerificationReport({ assert, schema: descriptions.verify.outputSchema, label: "extensions/verify output" });
  assert(descriptions.verify.outputSchema?.properties?.event?.required?.includes("id"), "extensions/verify output must expose event id");
  assert(descriptions.verifyAll.outputSchema?.required?.includes("ok"), "extensions/verifyAll output schema must require ok");
  assert(descriptions.verifyAll.outputSchema?.required?.includes("reports"), "extensions/verifyAll output schema must require reports");
  assertVerificationReport({ assert, schema: descriptions.verifyAll.outputSchema?.properties?.reports?.items, label: "extensions/verifyAll report" });
  assert(descriptions.status.outputSchema?.required?.includes("items"), "extensions/verificationStatus output schema must require items");
  assert(descriptions.status.outputSchema?.required?.includes("links"), "extensions/verificationStatus output schema must require links");
  const item = descriptions.status.outputSchema?.properties?.items?.items;
  assert(item?.required?.includes("eventId"), "extensions/verificationStatus item schema must require eventId");
  assert(item?.required?.includes("checkCount"), "extensions/verificationStatus item schema must require checkCount");
  assert(descriptions.status.outputSchema?.properties?.links?.items?.required?.includes("rel"), "extensions/verificationStatus link schema must require rel");
  assert(descriptions.status.outputSchema?.properties?.links?.items?.required?.includes("href"), "extensions/verificationStatus link schema must require href");
  assert(descriptions.status.outputSchema?.properties?.links?.items?.properties?.method?.type === "string", "extensions/verificationStatus link schema must expose method");
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

const assertVerificationReport = ({ assert, schema, label }) => {
  assert(schema?.required?.includes("extensionId"), `${label} schema must require extensionId`);
  assert(schema?.required?.includes("ok"), `${label} schema must require ok`);
  assert(schema?.required?.includes("checks"), `${label} schema must require checks`);
  assert(schema?.required?.includes("warnings"), `${label} schema must require warnings`);
  assert(schema?.required?.includes("errors"), `${label} schema must require errors`);
};
