import {
  assert, assertArray, buildGet, buildRpc, buildUrl, check, assertControlLegibilityAndThemeProjection,
  assertAgentOrientationPacket, assertAgentWorkbenchPacket, assertMethodDiscoveryParity, assertPanelLifecycleProjection,
  assertRpcCallDispatch, assertRuntimeCapabilityInventory, assertRuntimeModuleInventory,
  assertRuntimeStartedCapabilityInventory, assertRuntimeStartedControlPlane, assertRuntimeStartedModuleInventory, assertMatchingCapabilityInventories,
  assertMatchingModuleInventories, itemsFrom, results, rpc, rpcUrl, runtimeEventStream, runtimeGet
} from "./plastic-contract-helpers.mjs";
import { assertHttpErrorContract, rawBuildRequest, rawRuntimeRequest } from "./plastic-contract-http-helpers.mjs";
import { assertMethodCatalogSurface } from "./plastic-contract-method-surface.mjs";

const runId = `contract-${Date.now()}`;
const panelId = `${runId}-panel`;
const extensionId = `${runId}-extension`;
const backendMethodIds = [
  "codex/status", "codex/defaults", "codex/request", "codex/threadStart", "codex/turnStart", "codex/modelList",
  "bridge/configurePlasticMcp", "bridge/status", "bridge/test", "bridge/callPlasticRpcTool", "chats/getBinding", "chats/startCodexThread", "chats/createCodexChat", "chats/interrupt", "chats/sendToCodex"
];

let state;
let snapshot;
let methods;
let createdPanelEvent;
let extensions;
let events;

await check("plastic/state", async () => {
  state = await rpc("plastic/state");
  const runtimeState = await runtimeGet("/state");
  assert(state && typeof state === "object", "plastic/state returned no object");
  assert(runtimeState.value?.app?.name === "Plastic", "runtime /state did not return Plastic state");
  assert(state.app?.name === "Plastic", "state.app.name is not Plastic");
  assert(state.controlPlane?.runtime?.transport === "http", "state missing runtime control plane");
  assert(state.controlPlane.runtime.rpcPath === "/rpc", "state runtime control plane rpcPath mismatch");
  assert(state.controlPlane?.build?.transport === "http", "state missing build control plane");
  assert(state.controlPlane.build.rpcPath === "/rpc", "state build control plane rpcPath mismatch");
  assert(runtimeState.value?.controlPlane?.runtime?.transport === "http", "runtime /state missing runtime control plane");
  assert(runtimeState.value.controlPlane.runtime.rpcPath === state.controlPlane.runtime.rpcPath, "runtime /state control plane mismatch");
  const panelResources = Array.isArray(state.panels)
    ? state.panels
    : assertArray(state.resources, "state.resources is not an array")
      .filter((resource) => resource.id === "panels" || resource.kind === "panel");
  assert(panelResources.length > 0, "state does not expose panels");
  assert(state.app.mode === "electron" || state.app.mode === "headless", "state.app.mode must identify the host");
  return { mode: state.app.mode, panels: panelResources.length, events: state.events?.count ?? null, controlPlane: state.controlPlane.runtime.transport };
});

await check("plastic/methods", async () => {
  methods = await rpc("plastic/methods");
  const runtimeMethods = await runtimeGet("/methods");
  const items = assertArray(methods, "plastic/methods is not an array");
  const runtimeItems = assertArray(runtimeMethods.value, "runtime /methods is not an array");
  assert(runtimeItems.length === items.length, "runtime /methods count mismatch");
  assertMethodCatalogSurface({ assert, label: "plastic/methods", methods: items });
  const runtimeMethodIds = runtimeItems.map((method) => method.id).sort();
  assert(JSON.stringify(runtimeMethodIds) === JSON.stringify(items.map((method) => method.id).sort()), "runtime /methods ids diverged from plastic/methods");
  assertMethodCatalogSurface({ assert, label: "/methods", methods: runtimeItems });
  const missingAvailability = items.filter((method) => !method.availability?.status).map((method) => method.id); assert(missingAvailability.length === 0, `methods missing availability: ${missingAvailability.join(", ")}`);
  return { count: items.length };
});

await check("plastic/snapshot", async () => {
  snapshot = await rpc("plastic/snapshot");
  assert(snapshot?.app?.name === "Plastic", "snapshot.app.name is not Plastic");
  assert(snapshot.app.mode === "electron" || snapshot.app.mode === "headless", "snapshot.app.mode must identify the host");
  assertArray(snapshot.panels, "snapshot.panels is not an array");
  assertArray(snapshot.windows, "snapshot.windows is not an array");
  assertArray(snapshot.extensions, "snapshot.extensions is not an array");
  assertArray(snapshot.visibleRefs, "snapshot.visibleRefs is not an array");
  assert(snapshot.controlPlane?.runtime?.transport === "http", "snapshot missing runtime control plane");
  assert(snapshot.controlPlane.runtime.rpcPath === "/rpc", "snapshot runtime control plane rpcPath mismatch");
  assert(snapshot.controlPlane?.build?.transport === "http", "snapshot missing build control plane");
  assert(snapshot.controlPlane.build.rpcPath === "/rpc", "snapshot build control plane rpcPath mismatch");
  assert(snapshot.methods?.count >= 1, "snapshot.methods.count missing");
  assert(snapshot.methods.count === methods.length, "snapshot methods count does not match plastic/methods");
  assertMethodCatalogSurface({ assert, label: "snapshot", methods: snapshot.methods.items });
  assert(snapshot.events?.count >= 1, "snapshot.events.count missing");
  assert(snapshot.links?.some((link) => link.method === "runtime/capabilities"), "snapshot missing capabilities link");
  assert(snapshot.links?.some((link) => link.rel === "control-plane" && link.method === "events/list"), "snapshot missing control plane link");
  assert(snapshot.methods.items?.every((method) => method.availability?.status), "snapshot methods missing availability");
  return {
    mode: snapshot.app.mode, methods: snapshot.methods.count, panels: snapshot.panels.length,
    windows: snapshot.windows.length, extensions: snapshot.extensions.length, controlPlane: snapshot.controlPlane.runtime.transport
  };
});

await check("methods/describe", async () => {
  const description = await rpc("methods/describe", { id: "panels/create" });
  assert(description.id === "panels/create", "described wrong method");
  assert(description.owner?.id, "method owner missing");
  assert(description.links?.some((link) => link.rel === "describe" && link.method === "methods/describe" && link.target === description.id), "described method missing describe link");
  assert(description.links?.some((link) => link.rel === "invoke" && link.method === "rpc/call" && link.target === description.id), "described method missing invoke link");
  return { id: description.id, owner: description.owner, availability: description.availability?.status ?? "unspecified" };
});

await check("method discovery parity", async () => {
  const sampleIds = [
    "plastic/state",
    "panels/create",
    "events/append",
    "windows/screenshot",
    "deixis/evalDom",
    "chats/sendToCodex"
  ];
  await assertMethodDiscoveryParity({ methods, rpc, sampleIds });
  return { sampled: sampleIds.length };
});

await check("rpc/call dispatch", async () => {
  return assertRpcCallDispatch({ rpc });
});

await check("control method legibility and theme projection", async () => {
  return assertControlLegibilityAndThemeProjection({ methods, rpc });
});

await check("runtime/capabilities", async () => {
  const live = await assertRuntimeCapabilityInventory({ rpc });
  const durable = await assertRuntimeStartedCapabilityInventory({ rpc });
  assertMatchingCapabilityInventories({ live, durable });
  const byId = Object.fromEntries(live.items.map((capability) => [capability.id, capability]));
  const host = ["electron.window", "dom.refs", "dom.eval", "dom.input", "screenshot", "agent.codex"];
  const expectedHostCapability = state.app.mode === "electron" ? "available" : "unavailable";
  for (const id of host) assert(byId[id].status === expectedHostCapability, `${id} status mismatch`);
  const description = await rpc("methods/describe", { id: "runtime/capabilities" });
  assert(description.availability?.status === "available", "runtime/capabilities availability mismatch");
  return { live, durable, hostCapabilityStatus: expectedHostCapability };
});

await check("runtime/modules", async () => {
  const live = await assertRuntimeModuleInventory({ rpc });
  const durable = await assertRuntimeStartedModuleInventory({ rpc });
  assertMatchingModuleInventories({ live, durable });
  return { live, durable };
});

await check("agent/workbench", async () => {
  const workbench = await rpc("agent/workbench", { limit: 5 });
  return assertAgentWorkbenchPacket({ workbench, mode: state.app.mode });
});

await check("agent/orient", async () => {
  const orientation = await rpc("agent/orient", { panelId: "chat-main" });
  return assertAgentOrientationPacket(orientation);
});

await check("agent backend metadata", async () => {
  const expectedAvailability = state.app.mode === "electron" ? "available" : "unavailable";
  const descriptions = await Promise.all(
    backendMethodIds.map((id) => rpc("methods/describe", { id }))
  );
  for (const description of descriptions) {
    assert(description.availability?.status === expectedAvailability, `${description.id} availability mismatch`);
    assert(description.availability.requiredCapabilities?.includes("agent.codex"), `${description.id} missing agent.codex capability`);
  }
  const binding = await rpc("chats/getBinding", { chatId: "chat-main" });
  assert(binding.chatId === "chat-main", "chats/getBinding returned wrong chatId");
  return {
    availability: expectedAvailability,
    methods: descriptions.map((description) => description.id),
    bindingRuntime: binding.runtimeId ?? null
  };
});

await check("headless agent backend fallback", async () => {
  if (state.app.mode !== "headless") {
    return { skipped: true, reason: "fallback path is headless-only" };
  }
  const chatId = `${runId}-fallback-chat`;
  const created = await rpc("chats/createCodexChat", {
    id: chatId,
    title: "Contract Fallback Chat"
  });
  assert(created.chatId === chatId, "fallback chat returned wrong id");
  assert(created.threadId === null, "fallback chat should not bind a Codex thread");
  const sent = await rpc("chats/sendToCodex", {
    chatId,
    content: "Contract fallback message"
  });
  assert(sent.userEvent?.id, "fallback send missing user event");
  assert(sent.agentEvent?.id, "fallback send missing agent event");
  const timeline = await rpc("events/timeline", { scope: { panelId: chatId }, limit: 10 });
  const timelineItems = itemsFrom(timeline, "fallback timeline returned no items");
  assert(timelineItems.some((item) => item.eventId === sent.userEvent.id), "fallback user event missing from timeline");
  return {
    chatId,
    createEventId: created.panelEvent.id,
    userEventId: sent.userEvent.id,
    agentEventId: sent.agentEvent.id
  };
});

await check("build/status", async () => {
  const build = await rpc("build/status");
  const status = await buildGet("/status");
  assert(build?.status === "running", "build/status did not report running");
  assert(status.value?.status === build.status, "build /status did not match build/status");
  assert(status.value?.workspaceDir === build.workspaceDir, "build /status workspaceDir mismatch");
  assert(build.workspaceDir, "build/status missing workspaceDir");
  return {
    service: build.service,
    runtimeRpcUrl: build.runtimeRpcUrl ?? null,
    runtimePort: build.runtimePort ?? null
  };
});

await check("build HTTP transport", async () => {
  const controlPlane = await assertRuntimeStartedControlPlane({ rpc });
  const runtimeHealth = await runtimeGet("/healthz");
  const health = await buildGet("/healthz");
  const status = await buildGet("/status");
  const buildSnapshot = await buildGet("/snapshot");
  const diagnostics = await buildRpc("app/diagnostics", {});
  assert(runtimeHealth.service === "plastic.runtime", "runtime /healthz returned wrong service");
  assert(health.service === "plastic.build", "build /healthz returned wrong service");
  assert(status.value?.status === "running", "build /status did not report running");
  assert(status.value.buildSocket?.endsWith(`:${controlPlane.build.port}`), "build status socket does not match startup control plane");
  assert(buildSnapshot.value?.app?.mode === state.app.mode, "build /snapshot mode mismatch");
  assert(diagnostics?.workspaceDir, "build /rpc app/diagnostics missing workspaceDir");
  return {
    buildUrl,
    runtimePort: controlPlane.runtime.port,
    buildPort: controlPlane.build.port,
    service: status.value.service,
    snapshotMode: buildSnapshot.value.app.mode,
    diagnosticsWindowCount: diagnostics.windowCount
  };
});

await check("runtime HTTP error contract", async () => {
  return assertHttpErrorContract({ label: "runtime", rawRequest: rawRuntimeRequest, runId });
});

await check("build HTTP error contract", async () => {
  return assertHttpErrorContract({ label: "build", rawRequest: rawBuildRequest, runId });
});

await check("app/diagnostics", async () => {
  const diagnostics = await rpc("app/diagnostics");
  assert(diagnostics?.workspaceDir, "app/diagnostics missing workspaceDir");
  assert(typeof diagnostics.windowCount === "number", "app/diagnostics missing windowCount");
  return {
    workspaceDir: diagnostics.workspaceDir,
    windowCount: diagnostics.windowCount,
    appReady: diagnostics.appReady
  };
});

await check("renderer/reload metadata", async () => {
  const description = await rpc("methods/describe", { id: "renderer/reload" });
  assert(description.id === "renderer/reload", "described wrong renderer method");
  assert(description.availability?.status, "renderer/reload missing availability");
  assert(
    state.app.mode === "electron"
      ? description.availability.status === "available"
      : description.availability.status === "unavailable",
    "renderer/reload availability does not match host mode"
  );
  return {
    availability: description.availability.status,
    requiredCapabilities: description.availability.requiredCapabilities ?? []
  };
});

await check("capability-backed method metadata", async () => {
  const expectedVisualAvailability = state.app.mode === "electron" ? "available" : "unavailable";
  const expectedWindowListAvailability = state.app.mode === "electron" ? "available" : "degraded";
  const descriptions = await Promise.all(
    [
      "windows/list",
      "windows/create",
      "windows/focusPanel",
      "windows/scrollToRef",
      "windows/screenshot",
      "deixis/listVisibleRefs",
      "deixis/resolveRef",
      "deixis/evalDom",
      "deixis/clickRef",
      "deixis/fillRef",
      "deixis/verifyRefAction"
    ].map((id) => rpc("methods/describe", { id }))
  );
  const byId = Object.fromEntries(descriptions.map((description) => [description.id, description]));
  assert(byId["windows/list"].availability?.status === expectedWindowListAvailability, "windows/list availability mismatch");
  for (const id of [
    "windows/create",
    "windows/focusPanel",
    "windows/scrollToRef",
    "windows/screenshot",
    "deixis/listVisibleRefs",
    "deixis/resolveRef",
    "deixis/evalDom",
    "deixis/clickRef",
    "deixis/fillRef",
    "deixis/verifyRefAction"
  ]) {
    assert(byId[id].availability?.status === expectedVisualAvailability, `${id} availability mismatch`);
    assert(Array.isArray(byId[id].availability.requiredCapabilities), `${id} missing required capabilities`);
  }
  const windows = await rpc("windows/list");
  assertArray(windows, "windows/list is not an array");
  if (state.app.mode === "headless") {
    try {
      await rpc("windows/screenshot", {});
      throw new Error("windows/screenshot unexpectedly succeeded in headless mode");
    } catch (error) {
      assert(String(error.message ?? error).includes("unavailable"), "headless screenshot error was not explicit");
    }
  } else {
    const refs = await rpc("deixis/listVisibleRefs", {});
    assertArray(refs, "deixis/listVisibleRefs is not an array");
    const screenshot = await rpc("windows/screenshot", {});
    assert(screenshot?.dataUrl?.startsWith("data:image/png"), "windows/screenshot missing PNG data URL");
  }
  return {
    mode: state.app.mode,
    windowsList: byId["windows/list"].availability.status,
    visualAvailability: expectedVisualAvailability,
    methods: descriptions.length,
    windows: windows.length
  };
});

await check("events/append", async () => {
  const appended = await rpc("events/append", {
    type: "contract.event.appended",
    payload: { runId },
    scope: { workspaceId: "default" }
  });
  assert(appended?.id, "events/append returned no event id");
  const appendedEvents = await rpc("events/list", { type: "contract.event.appended", limit: 10 });
  assertArray(appendedEvents, "events/list after append is not an array");
  assert(appendedEvents.some((event) => event.id === appended.id), "appended event not readable");
  return { eventId: appended.id };
});

await check("runtime event stream", async () => {
  const streamed = await runtimeEventStream({
    trigger: () => rpc("events/append", {
      type: "contract.event_stream.appended",
      payload: { runId },
      scope: { workspaceId: "default" }
    })
  });
  assert(streamed.ready, "runtime event stream did not emit ready");
  assert(streamed.event, "runtime event stream did not emit appended event");
  return streamed;
});

await check("panel lifecycle", async () => {
  createdPanelEvent = await assertPanelLifecycleProjection({ rpc, panelId });
  return createdPanelEvent;
});

await check("extensions/scaffold", async () => {
  const scaffold = await rpc("extensions/scaffold", {
    id: extensionId,
    title: "Contract Extension",
    panelTitle: "Contract Extension Panel",
    body: "Created by scripts/plastic-contract.mjs"
  });
  assert(scaffold?.extensionId === `workspace.${extensionId}`, "scaffold returned wrong extension id");
  assert(scaffold.manifestPath, "scaffold missing manifestPath");
  assert(scaffold.eventId, "scaffold missing eventId");
  const scan = await rpc("extensions/scan");
  const discovered = assertArray(scan.discovered, "extensions/scan discovered is not an array");
  assert(discovered.some((extension) => extension.id === scaffold.extensionId), "scaffolded extension not discovered");
  return {
    extensionId: scaffold.extensionId,
    panelId: scaffold.panelId,
    eventId: scaffold.eventId
  };
});

await check("extensions scan/list", async () => {
  const scan = await rpc("extensions/scan");
  extensions = await rpc("extensions/list");
  const items = assertArray(extensions, "extensions/list is not an array");
  assert(items.some((extension) => extension.id === "plastic.chat"), "bundled chat extension missing");
  return {
    scanDiscovered: scan.discovered?.length ?? scan.count ?? null,
    count: items.length
  };
});

await check("bundled extension projections", async () => {
  const projectedPanels = await rpc("panels/list");
  const projectedExtensions = extensions ?? await rpc("extensions/list");
  const panels = assertArray(projectedPanels, "panels/list is not an array");
  const extensionItems = assertArray(projectedExtensions, "extensions/list is not an array");
  const bundledExtensions = extensionItems.filter((extension) => extension.source === "bundled");
  assert(bundledExtensions.length > 0, "no bundled extensions projected");
  const bundledPanels = panels.filter((panel) =>
    panel.extensionId && bundledExtensions.some((extension) => extension.id === panel.extensionId)
  );
  assert(bundledPanels.length > 0, "no bundled panels projected");
  assert(bundledPanels.some((panel) => panel.rendererId), "no bundled panel has a renderer binding");
  return {
    bundledExtensions: bundledExtensions.length,
    bundledPanels: bundledPanels.length,
    rendererBoundPanels: bundledPanels.filter((panel) => panel.rendererId).length
  };
});

await check("events list/timeline", async () => {
  events = await rpc("events/list", { types: ["panel.created"], scope: { panelId }, limit: 100 });
  const eventItems = assertArray(events, "events/list is not an array");
  assert(eventItems.length > 0, "events/list returned no events");
  assert(eventItems.some((event) => event.id === createdPanelEvent.id), "panel create event missing from typed events");
  const timeline = await rpc("events/timeline", { scope: { panelId }, limit: 10 });
  const timelineItems = itemsFrom(timeline, "events/timeline returned no items");
  assert(timelineItems.some((item) => item.eventId === createdPanelEvent.id), "panel create event missing from timeline");
  return {
    events: eventItems.length,
    timeline: timelineItems.length
  };
});

await check("plastic/selfTest", async () => {
  const selfTest = await rpc("plastic/selfTest");
  assert(selfTest.ok === true, "plastic/selfTest failed");
  const methodCheck = selfTest.checks?.find((candidate) => candidate.id === "methods:list");
  assert(methodCheck?.details?.invalidIdentity?.length === 0, "plastic/selfTest method identity check failed");
  assert(methodCheck?.details?.missingAvailability?.length === 0, "plastic/selfTest method availability check failed");
  assert(methodCheck.details.invalidAvailabilityStatuses?.length === 0, "plastic/selfTest method availability status check failed");
  assert(methodCheck.details.missingReferencedCapabilities?.length === 0, "plastic/selfTest method capability reference check failed");
  assert(methodCheck.details.missingRequiredMethods?.length === 0, "plastic/selfTest required method check failed");
  const capabilityCheck = selfTest.checks?.find((candidate) => candidate.id === "capabilities:list");
  assert(capabilityCheck?.details?.missingRequiredCapabilities?.length === 0, "plastic/selfTest required capability check failed");
  assert(capabilityCheck.details.invalidStatuses?.length === 0, "plastic/selfTest capability status check failed");
  const moduleCheck = selfTest.checks?.find((candidate) => candidate.id === "runtime-modules:map");
  assert(moduleCheck?.details?.missingRequiredModules?.length === 0, "plastic/selfTest required module check failed");
  assert(moduleCheck.details.missingAgentBackend === false, "plastic/selfTest agent backend module check failed");
  assert(moduleCheck.details.missingMethodIds?.length === 0, "plastic/selfTest module methodIds check failed");
  assert(moduleCheck.details.missingAvailabilitySummary?.length === 0, "plastic/selfTest module availability summary check failed");
  assert(moduleCheck.details.invalidAvailabilityCounts?.length === 0, "plastic/selfTest module availability count check failed");
  assert(moduleCheck.details.missingContributions?.length === 0, "plastic/selfTest module contribution check failed");
  return {
    checks: selfTest.checks?.length ?? null
  };
});

const failed = results.filter((result) => !result.ok);
const summary = {
  ok: failed.length === 0,
  rpcUrl,
  checks: results.length,
  failed: failed.length,
  results
};

console.log(JSON.stringify(summary, null, 2));

if (failed.length > 0) {
  process.exitCode = 1;
}
