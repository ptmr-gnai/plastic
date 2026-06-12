import { access, rm } from "node:fs/promises";
import {
  assert, assertArray, buildEventStream, buildGet, buildRpc, buildUrl, check, assertControlLegibilityAndThemeProjection,
  assertEventsTagged, assertMethodDiscoveryParity, assertPanelLifecycleProjection,
  assertCapabilityStatuses, assertRpcCallDispatch, assertRuntimeCapabilityInventory, assertRuntimeModuleInventory,
  assertRuntimeStartedCapabilityInventory, assertRuntimeStartedControlPlane, assertRuntimeStartedModuleInventory, assertMatchingCapabilityInventories,
  assertMatchingModuleInventories, assertRuntimeAuditStatus, assertModuleMethodDiscoveryParity, itemsFrom, results, rpc, rpcUrl, runtimeEventStream, runtimeGet
} from "./plastic-contract-helpers.mjs";
import { assertAgentOrientationPacket, assertAgentWorkbenchPacket } from "./plastic-contract-agent-packets.mjs";
import { assertControlPlaneEndpointUrls, assertMatchingControlPlaneDescriptors } from "./plastic-contract-control-plane.mjs";
import { assertHttpErrorContract, rawBuildRequest, rawRuntimeRequest } from "./plastic-contract-http-helpers.mjs";
import { assertRuntimeHostSurface } from "./plastic-contract-host.mjs";
import { assertMethodCatalogsMatch, assertMethodCatalogSurface } from "./plastic-contract-method-surface.mjs";
import { assertSelfTestSurface } from "./plastic-contract-self-test.mjs";
import { assertBuildHttpTransportSurface, assertBuildStatusSurface } from "./plastic-contract-build-surfaces.mjs";
import {
  assertHeadlessFallbackChatFixture,
  assertNoActiveContractFixtures,
  cleanupLegacyContractFixtures
} from "./plastic-contract-fixtures.mjs";
import {
  agentBackendMethodExpectationsForMode,
  capabilityBackedMethodExpectationsForMode
} from "./plastic-capability-expectations.mjs";
import { assertModuleAvailabilitySummaries, assertRuntimeModuleOrder } from "./plastic-module-availability.mjs";

const runId = `contract-${Date.now()}`;
const panelId = `${runId}-panel`;
const extensionId = `${runId}-extension`;
const validationTags = ["validation", "validation:contract"];
const validationMeta = { tags: validationTags };
let state;
let snapshot;
let methods;
let methodIds;
let runtimeCapabilities;
let runtimeModules;
let createdPanelEvent;
let extensions;
let events;
let runtimeStartedControlPlane;
let scaffoldedExtensionDir, scaffoldedExtensionId, scaffoldedExtensionPanelId;

await check("plastic/state", async () => {
  state = await rpc("plastic/state");
  runtimeStartedControlPlane = await assertRuntimeStartedControlPlane({ rpc });
  const runtimeState = await runtimeGet("/state");
  const buildState = await buildGet("/state");
  assert(state && typeof state === "object", "plastic/state returned no object");
  assert(runtimeState.value?.app?.name === "Plastic", "runtime /state did not return Plastic state");
  assert(buildState.value?.app?.name === "Plastic", "build /state did not return Plastic state");
  assert(state.app?.name === "Plastic", "state.app.name is not Plastic");
  assert(state.app.hostBase?.id === "runtime-host-base" && state.app.hostBase?.version === 1, "plastic/state shared host base marker mismatch");
  assert(state.controlPlane?.runtime?.transport === "http", "state missing runtime control plane");
  assert(state.controlPlane.runtime.rpcPath === "/rpc", "state runtime control plane rpcPath mismatch");
  assert(state.controlPlane.runtime.statePath === "/state", "state runtime control plane statePath mismatch");
  assert(state.controlPlane.runtime.methodsPath === "/methods", "state runtime control plane methodsPath mismatch");
  assert(state.controlPlane?.build?.transport === "http", "state missing build control plane");
  assert(state.controlPlane.build.rpcPath === "/rpc", "state build control plane rpcPath mismatch");
  assert(state.controlPlane.build.statePath === "/state", "state build control plane statePath mismatch");
  assert(state.controlPlane.build.methodsPath === "/methods", "state build control plane methodsPath mismatch");
  assert(state.controlPlane.build.eventStreamPath === "/events/stream", "state build control plane eventStreamPath mismatch");
  assertControlPlaneEndpointUrls({ assert, controlPlane: state.controlPlane, source: "state" });
  assertMatchingControlPlaneDescriptors({ assert, actual: state.controlPlane, expected: runtimeStartedControlPlane, source: "plastic/state" });
  assert(runtimeState.value?.controlPlane?.runtime?.transport === "http", "runtime /state missing runtime control plane");
  assert(runtimeState.value.controlPlane.runtime.rpcPath === state.controlPlane.runtime.rpcPath, "runtime /state control plane mismatch");
  assertMatchingControlPlaneDescriptors({ assert, actual: runtimeState.value.controlPlane, expected: runtimeStartedControlPlane, source: "runtime /state" });
  assert(buildState.value?.app?.mode === state.app.mode, "build /state mode mismatch");
  assert(buildState.value?.controlPlane?.build?.statePath === state.controlPlane.build.statePath, "build /state control plane mismatch");
  assertMatchingControlPlaneDescriptors({ assert, actual: buildState.value.controlPlane, expected: runtimeStartedControlPlane, source: "build /state" });
  const panelResources = Array.isArray(state.panels)
    ? state.panels
    : assertArray(state.resources, "state.resources is not an array")
      .filter((resource) => resource.id === "panels" || resource.kind === "panel");
  const serviceResources = assertArray(state.resources, "state.resources is not an array").filter((resource) => resource.kind === "service");
  assert(serviceResources.some((resource) => resource.links?.some((link) => link.method === "runtime/host") && resource.actions?.some((action) => action.method === "runtime/host")), "state service resource missing host affordances");
  assert(serviceResources.some((resource) => resource.links?.some((link) => link.method === "runtime/capabilities") && resource.actions?.some((action) => action.method === "runtime/capabilities")), "state service resource missing capabilities affordances");
  assert(panelResources.length > 0, "state does not expose panels");
  assert(state.app.mode === "electron" || state.app.mode === "headless", "state.app.mode must identify the host");
  assert(runtimeStartedControlPlane.mode === state.app.mode, "runtime.started mode mismatch");
  return { mode: state.app.mode, panels: panelResources.length, events: state.events?.count ?? null, controlPlane: state.controlPlane.runtime.transport };
});

await check("plastic/methods", async () => {
  methods = await rpc("plastic/methods");
  const runtimeMethods = await runtimeGet("/methods");
  const buildMethods = await buildGet("/methods");
  const items = assertArray(methods, "plastic/methods is not an array");
  methodIds = new Set(items.map((method) => method.id));
  const runtimeItems = assertArray(runtimeMethods.value, "runtime /methods is not an array");
  const buildItems = assertArray(buildMethods.value, "build /methods is not an array");
  assert(runtimeItems.length === items.length, "runtime /methods count mismatch");
  assert(buildItems.length === items.length, "build /methods count mismatch");
  assertMethodCatalogSurface({ assert, label: "plastic/methods", methods: items });
  const runtimeMethodIds = runtimeItems.map((method) => method.id).sort();
  const buildMethodIds = buildItems.map((method) => method.id).sort();
  assert(JSON.stringify(runtimeMethodIds) === JSON.stringify(items.map((method) => method.id).sort()), "runtime /methods ids diverged from plastic/methods");
  assert(JSON.stringify(buildMethodIds) === JSON.stringify(items.map((method) => method.id).sort()), "build /methods ids diverged from plastic/methods");
  assertMethodCatalogSurface({ assert, label: "/methods", methods: runtimeItems });
  assertMethodCatalogSurface({ assert, label: "build /methods", methods: buildItems });
  assertMethodCatalogsMatch({ assert, actual: runtimeItems, expected: items, actualLabel: "runtime /methods", expectedLabel: "plastic/methods" });
  assertMethodCatalogsMatch({ assert, actual: buildItems, expected: items, actualLabel: "build /methods", expectedLabel: "plastic/methods" });
  const missingAvailability = items.filter((method) => !method.availability?.status).map((method) => method.id); assert(missingAvailability.length === 0, `methods missing availability: ${missingAvailability.join(", ")}`);
  return { count: items.length };
});

await check("legacy contract fixture cleanup", async () => {
  return cleanupLegacyContractFixtures({ assertArray, rpc, validationMeta });
});

await check("plastic/snapshot", async () => {
  snapshot = await rpc("plastic/snapshot");
  assert(snapshot?.app?.name === "Plastic", "snapshot.app.name is not Plastic");
  assert(snapshot.app.mode === "electron" || snapshot.app.mode === "headless", "snapshot.app.mode must identify the host");
  assert(snapshot.app.hostBase?.id === "runtime-host-base" && snapshot.app.hostBase?.version === 1, "plastic/snapshot shared host base marker mismatch");
  assertArray(snapshot.panels, "snapshot.panels is not an array");
  assertArray(snapshot.windows, "snapshot.windows is not an array");
  assertArray(snapshot.extensions, "snapshot.extensions is not an array");
  assertArray(snapshot.visibleRefs, "snapshot.visibleRefs is not an array");
  assert(snapshot.controlPlane?.runtime?.transport === "http", "snapshot missing runtime control plane");
  assert(snapshot.controlPlane.runtime.rpcPath === "/rpc", "snapshot runtime control plane rpcPath mismatch");
  assert(snapshot.controlPlane.runtime.statePath === "/state", "snapshot runtime control plane statePath mismatch");
  assert(snapshot.controlPlane.runtime.methodsPath === "/methods", "snapshot runtime control plane methodsPath mismatch");
  assert(snapshot.controlPlane?.build?.transport === "http", "snapshot missing build control plane");
  assert(snapshot.controlPlane.build.rpcPath === "/rpc", "snapshot build control plane rpcPath mismatch");
  assert(snapshot.controlPlane.build.statePath === "/state", "snapshot build control plane statePath mismatch");
  assert(snapshot.controlPlane.build.methodsPath === "/methods", "snapshot build control plane methodsPath mismatch");
  assert(snapshot.controlPlane.build.eventStreamPath === "/events/stream", "snapshot build control plane eventStreamPath mismatch");
  assertControlPlaneEndpointUrls({ assert, controlPlane: snapshot.controlPlane, source: "snapshot" });
  assertMatchingControlPlaneDescriptors({ assert, actual: snapshot.controlPlane, expected: runtimeStartedControlPlane, source: "snapshot" });
  assert(snapshot.methods?.count >= 1, "snapshot.methods.count missing");
  assert(snapshot.methods.count === methods.length, "snapshot methods count does not match plastic/methods");
  assertMethodCatalogSurface({ assert, label: "snapshot", methods: snapshot.methods.items });
  assertMethodCatalogsMatch({ assert, actual: snapshot.methods.items, expected: methods, actualLabel: "snapshot methods", expectedLabel: "plastic/methods" });
  assert(snapshot.events?.count >= 1, "snapshot.events.count missing");
  assert(snapshot.links?.some((link) => link.method === "runtime/host") && snapshot.links?.some((link) => link.method === "runtime/capabilities"), "snapshot missing host or capabilities link");
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

await check("plastic/selfTest description", async () => {
  const description = await rpc("methods/describe", { id: "plastic/selfTest" });
  assert(description.id === "plastic/selfTest", "described wrong self-test method");
  assert(description.outputSchema?.required?.includes("summary"), "plastic/selfTest output schema must require summary");
  assert(description.outputSchema?.properties?.summary?.required?.includes("sharedCheckIds"), "plastic/selfTest summary schema must expose sharedCheckIds");
  assert(description.outputSchema?.properties?.summary?.required?.includes("hostCheckIds"), "plastic/selfTest summary schema must expose hostCheckIds");
  assert(description.effects?.durableEvents?.includes("plastic.self_test.completed"), "plastic/selfTest missing durable event effect");
  return { id: description.id, summaryRequired: description.outputSchema.properties.summary.required };
});

await check("runtime/runAuditAction description", async () => {
  const description = await rpc("methods/describe", { id: "runtime/runAuditAction" });
  const planDescription = await rpc("methods/describe", { id: "runtime/auditActionPlan" });
  assert(description.id === "runtime/runAuditAction", "described wrong audit action method");
  assert(planDescription.id === "runtime/auditActionPlan", "described wrong audit action plan method");
  assert(description.inputSchema?.required?.includes("id"), "runtime/runAuditAction input schema must require id");
  assert(planDescription.inputSchema?.required?.includes("id"), "runtime/auditActionPlan input schema must require id");
  assert(description.effects?.durableEvents?.includes("runtime.auditAction.completed"), "runtime/runAuditAction missing durable event effect");
  assert(planDescription.effects?.durableEvents?.length === 0, "runtime/auditActionPlan should not append durable events");
  assert(description.examples?.some((example) => example.input?.id && example.verifyWith?.method === "runtime/auditStatus"), "runtime/runAuditAction example must teach audit-status verification");
  assert(planDescription.examples?.some((example) => example.input?.id && example.verifyWith?.method === "runtime/auditStatus"), "runtime/auditActionPlan example must teach audit-status verification");
  assert(description.links?.some((link) => link.rel === "invoke" && link.method === "rpc/call" && link.target === description.id), "runtime/runAuditAction missing invoke link");
  assert(planDescription.links?.some((link) => link.rel === "invoke" && link.method === "rpc/call" && link.target === planDescription.id), "runtime/auditActionPlan missing invoke link");
  const auditStatus = await rpc("runtime/auditStatus");
  assert(auditStatus.verdict?.actions?.every((action) => action.run?.command && Array.isArray(action.run?.args)), "runtime/runAuditAction actions missing structured run metadata");
  const action = auditStatus.verdict.actions[0];
  const plan = await rpc("runtime/auditActionPlan", { id: action.id });
  assert(plan.id === action.id, "runtime/auditActionPlan id mismatch");
  assert(plan.command === action.run.command, "runtime/auditActionPlan command mismatch");
  assert(JSON.stringify(plan.args) === JSON.stringify(action.run.args), "runtime/auditActionPlan args mismatch");
  assert(plan.invocation?.method === "runtime/runAuditAction" && plan.invocation?.input?.id === action.id, "runtime/auditActionPlan invocation mismatch");
  return { id: description.id, planId: planDescription.id, plannedAction: plan.id, durableEvents: description.effects.durableEvents };
});

await check("bridge/callPlasticRpcTool description", async () => {
  const description = await rpc("methods/describe", { id: "bridge/callPlasticRpcTool" });
  assert(description.description?.includes("agent/orient"), "bridge/callPlasticRpcTool must teach agent/orient orientation");
  assert(description.description?.includes("runtime/auditStatus"), "bridge/callPlasticRpcTool must teach runtime/auditStatus");
  assert(description.description?.includes("delegated method effects"), "bridge/callPlasticRpcTool must describe delegated method effects");
  assert(description.examples?.some((example) => example.input?.method === "agent/orient"), "bridge/callPlasticRpcTool example must call agent/orient");
  return { id: description.id, examples: description.examples.length };
});

await check("method discovery parity", async () => {
  const sampleIds = ["plastic/state", "panels/create", "events/append", "windows/screenshot", "deixis/evalDom", "chats/sendToCodex"];
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
  runtimeCapabilities = live;
  assertMatchingCapabilityInventories({ live, durable });
  const expectations = assertCapabilityStatuses({ items: live.items, mode: state.app.mode });
  assertCapabilityStatuses({ items: durable.items, mode: state.app.mode });
  const description = await rpc("methods/describe", { id: "runtime/capabilities" });
  assert(description.availability?.status === "available", "runtime/capabilities availability mismatch");
  return { live, durable, expectedStatuses: expectations };
});

await check("runtime/host", async () => {
  return assertRuntimeHostSurface({ assert, assertArray, rpc, mode: state.app.mode, runtimeStartedControlPlane, assertMatchingControlPlaneDescriptors });
});

await check("runtime/modules", async () => {
  const live = await assertRuntimeModuleInventory({ rpc });
  const durable = await assertRuntimeStartedModuleInventory({ rpc });
  runtimeModules = live;
  assertMatchingModuleInventories({ live, durable });
  assertRuntimeModuleOrder({ assert, modules: live, source: "runtime/modules" });
  assertRuntimeModuleOrder({ assert, modules: durable, source: "runtime.started modules" });
  assertModuleAvailabilitySummaries({ assert, modules: live, methods, source: "runtime/modules" });
  assertModuleAvailabilitySummaries({ assert, modules: durable, methods, source: "runtime.started modules" });
  await assertModuleMethodDiscoveryParity({ methods, modules: live, rpc });
  return { live, durable };
});

await check("agent/workbench", async () => {
  const workbench = await rpc("agent/workbench", { limit: 5 });
  const shared = { assert, assertArray, mode: state.app.mode, methodCount: methods.length, capabilityCount: runtimeCapabilities.count, modules: runtimeModules, methodIds };
  return assertAgentWorkbenchPacket({ ...shared, workbench });
});

await check("agent/orient", async () => {
  const orientation = await rpc("agent/orient", { panelId: "chat-main" });
  const shared = { assert, assertArray, methodCount: methods.length, capabilityCount: runtimeCapabilities.count, modules: runtimeModules, methodIds };
  return assertAgentOrientationPacket({ ...shared, orientation });
});

await check("agent backend metadata", async () => {
  const expectations = agentBackendMethodExpectationsForMode(state.app.mode);
  const descriptions = await Promise.all(
    Object.keys(expectations).map((id) => rpc("methods/describe", { id }))
  );
  for (const description of descriptions) {
    const expected = expectations[description.id];
    const availability = description.availability;
    assert(availability?.status === expected.status, `${description.id} availability mismatch`);
    assert(JSON.stringify(availability.requiredCapabilities ?? []) === JSON.stringify(expected.requiredCapabilities), `${description.id} required capabilities mismatch`);
    assert(JSON.stringify(availability.missingCapabilities ?? []) === JSON.stringify(expected.missingCapabilities), `${description.id} missing capabilities mismatch`);
  }
  const binding = await rpc("chats/getBinding", { chatId: "chat-main" });
  assert(binding.chatId === "chat-main", "chats/getBinding returned wrong chatId");
  return {
    expectations,
    methods: descriptions.map((description) => description.id),
    bindingRuntime: binding.runtimeId ?? null
  };
});

await check("headless agent backend fallback", async () => {
  if (state.app.mode !== "headless") {
    return { skipped: true, reason: "fallback path is headless-only" };
  }
  return assertHeadlessFallbackChatFixture({ assert, assertArray, assertEventsTagged, itemsFrom, rpc, runId, validationMeta, validationTags });
});

await check("build/status", async () => {
  return assertBuildStatusSurface({ assert, assertArray, buildGet, rpc, state, runtimeStartedControlPlane });
});

await check("build HTTP transport", async () => {
  return assertBuildHttpTransportSurface({
    assert,
    assertArray,
    assertRuntimeStartedControlPlane,
    buildGet,
    buildRpc,
    buildUrl,
    runtimeGet,
    rpc,
    state
  });
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
  assert(diagnostics.mode === state.app.mode, "app/diagnostics mode mismatch");
  assert(diagnostics.hostBase?.id === "runtime-host-base", "app/diagnostics missing shared host base marker");
  assert(typeof diagnostics.windowCount === "number", "app/diagnostics missing windowCount");
  return {
    mode: diagnostics.mode,
    workspaceDir: diagnostics.workspaceDir,
    windowCount: diagnostics.windowCount,
    appReady: diagnostics.appReady
  };
});
await check("runtime/auditStatus", async () => {
  return assertRuntimeAuditStatus(await rpc("runtime/auditStatus"));
});
await check("renderer/reload metadata", async () => {
  const expectations = capabilityBackedMethodExpectationsForMode(state.app.mode);
  const description = await rpc("methods/describe", { id: "renderer/reload" });
  const expected = expectations["renderer/reload"];
  assert(description.id === "renderer/reload", "described wrong renderer method");
  assert(description.availability?.status, "renderer/reload missing availability");
  assert(description.availability.status === expected.status, "renderer/reload availability does not match host mode");
  return {
    availability: description.availability.status,
    requiredCapabilities: description.availability.requiredCapabilities ?? []
  };
});

await check("capability-backed method metadata", async () => {
  const expectations = capabilityBackedMethodExpectationsForMode(state.app.mode);
  const descriptions = await Promise.all(
    Object.keys(expectations).map((id) => rpc("methods/describe", { id }))
  );
  const byId = Object.fromEntries(descriptions.map((description) => [description.id, description]));
  for (const [id, expected] of Object.entries(expectations)) {
    const availability = byId[id].availability;
    assert(availability?.status === expected.status, `${id} availability mismatch`);
    assert(JSON.stringify(availability.requiredCapabilities ?? []) === JSON.stringify(expected.requiredCapabilities), `${id} required capabilities mismatch`);
    assert(JSON.stringify(availability.missingCapabilities ?? []) === JSON.stringify(expected.missingCapabilities), `${id} missing capabilities mismatch`);
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
    expectations,
    methods: descriptions.length,
    windows: windows.length
  };
});

await check("events/append", async () => {
  const appended = await rpc("events/append", {
    type: "contract.event.appended",
    payload: { runId },
    scope: { workspaceId: "default" },
    meta: validationMeta
  });
  assert(appended?.id, "events/append returned no event id");
  const appendedEvents = await rpc("events/list", { type: "contract.event.appended", limit: 10 });
  assertArray(appendedEvents, "events/list after append is not an array");
  const appendedEvent = appendedEvents.find((event) => event.id === appended.id); assert(appendedEvent, "appended event not readable");
  assert(validationTags.every((tag) => appendedEvent.meta?.tags?.includes(tag)), "appended validation tags not readable");
  return { eventId: appended.id };
});

await check("runtime event stream", async () => {
  const runtimeStream = await runtimeEventStream({
    trigger: () => rpc("events/append", {
      type: "contract.event_stream.appended",
      payload: { runId },
      scope: { workspaceId: "default" },
      meta: validationMeta
    })
  });
  assert(runtimeStream.ready, "runtime event stream did not emit ready");
  assert(runtimeStream.event, "runtime event stream did not emit appended event");
  const buildStream = await buildEventStream({
    trigger: () => rpc("events/append", {
      type: "contract.build_event_stream.appended",
      payload: { runId },
      scope: { workspaceId: "default" },
      meta: validationMeta
    })
  });
  assert(buildStream.ready, "build event stream did not emit ready");
  assert(buildStream.event, "build event stream did not emit appended event");
  return { runtime: runtimeStream, build: buildStream };
});
await check("panel lifecycle", async () => {
  createdPanelEvent = await assertPanelLifecycleProjection({ rpc, panelId, meta: validationMeta });
  const panelEvents = await rpc("events/list", { types: ["panel.created", "panel.renamed", "panel.moved", "panel.removed"], scope: { panelId }, limit: 10 });
  assertEventsTagged(assertArray(panelEvents, "panel lifecycle events/list is not an array"), validationTags, "panel lifecycle validation tags not readable");
  return createdPanelEvent;
});
await check("extensions/scaffold", async () => {
  const scaffold = await rpc("extensions/scaffold", {
    id: extensionId,
    title: "Contract Extension",
    panelTitle: "Contract Extension Panel",
    body: "Created by scripts/plastic-contract.mjs",
    meta: validationMeta
  });
  assert(scaffold?.extensionId === `workspace.${extensionId}`, "scaffold returned wrong extension id");
  assert(scaffold.manifestPath, "scaffold missing manifestPath");
  assert(scaffold.eventId, "scaffold missing eventId");
  const scan = await rpc("extensions/scan", { meta: validationMeta });
  const discovered = assertArray(scan.discovered, "extensions/scan discovered is not an array");
  assert(discovered.some((extension) => extension.id === scaffold.extensionId), "scaffolded extension not discovered");
  assertEventsTagged(assertArray(await rpc("events/list", { types: ["extension.discovered"], scope: { extensionId: scaffold.extensionId }, limit: 10 }), "extension discovered events/list is not an array"), validationTags, "extension discovered validation tags not readable");
  assertEventsTagged(assertArray(await rpc("events/list", { types: ["extension.scaffolded"], scope: { extensionId: scaffold.extensionId }, limit: 10 }), "extension scaffold events/list is not an array"), validationTags, "extension scaffold validation tags not readable");
  scaffoldedExtensionDir = scaffold.extensionDir;
  scaffoldedExtensionId = scaffold.extensionId;
  scaffoldedExtensionPanelId = scaffold.panelId;
  return { extensionId: scaffold.extensionId, panelId: scaffold.panelId, extensionDir: scaffold.extensionDir, eventId: scaffold.eventId };
});
await check("extensions scan/list", async () => {
  const scan = await rpc("extensions/scan", { meta: validationMeta });
  extensions = await rpc("extensions/list");
  const items = assertArray(extensions, "extensions/list is not an array");
  assert(items.some((extension) => extension.id === "plastic.chat"), "bundled chat extension missing");
  return { scanDiscovered: scan.discovered?.length ?? scan.count ?? null, count: items.length };
});
await check("contract scaffold cleanup", async () => {
  assert(scaffoldedExtensionDir, "no scaffolded extension dir recorded");
  assert(scaffoldedExtensionId, "no scaffolded extension id recorded");
  assert(scaffoldedExtensionPanelId, "no scaffolded extension panel id recorded");
  await rm(scaffoldedExtensionDir, { recursive: true, force: true });
  await access(scaffoldedExtensionDir)
    .then(() => {
      throw new Error("scaffolded extension dir still exists after cleanup");
    })
    .catch((error) => { if (error?.code !== "ENOENT") throw error; });
  const scan = await rpc("extensions/scan", { meta: validationMeta });
  const discovered = assertArray(scan.discovered, "extensions/scan discovered is not an array");
  assert(!discovered.some((extension) => extension.id === scaffoldedExtensionId), "scaffolded extension still discovered after cleanup");
  assertEventsTagged(assertArray(await rpc("events/list", { types: ["extension.removed"], scope: { extensionId: scaffoldedExtensionId }, limit: 10 }), "extension removed events/list is not an array"), validationTags, "extension removed validation tags not readable");
  await rpc("panels/close", { id: scaffoldedExtensionPanelId });
  const panels = await rpc("panels/list");
  assert(!panels.some((panel) => panel.id === scaffoldedExtensionPanelId), "scaffolded extension panel still projected after cleanup");
  extensions = await rpc("extensions/list");
  return { extensionId: scaffoldedExtensionId, panelId: scaffoldedExtensionPanelId, removed: true, scanDiscovered: scan.discovered?.length ?? scan.count ?? null };
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
  return { events: eventItems.length, timeline: timelineItems.length };
});
await check("plastic/selfTest", async () => assertSelfTestSurface({ assert, selfTest: await rpc("plastic/selfTest") }));
await check("contract fixture stability", async () =>
  assertNoActiveContractFixtures({ assert, assertArray, rpc })
);
const failed = results.filter((result) => !result.ok);
const summary = { ok: failed.length === 0, rpcUrl, checks: results.length, failed: failed.length, results };
console.log(JSON.stringify(summary, null, 2));
if (failed.length > 0) process.exitCode = 1;
