const rpcUrl = process.env.PLASTIC_RPC_URL ?? "http://127.0.0.1:7331/rpc";
const buildUrl = process.env.PLASTIC_BUILD_URL ?? "http://127.0.0.1:7332";
const runId = `contract-${Date.now()}`;
const panelId = `${runId}-panel`;
const extensionId = `${runId}-extension`;

const results = [];

const rpc = async (method, input) => {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, input })
  });
  const payload = await response.json().catch(() => {
    throw new Error(`${method}: response was not JSON`);
  });
  if (!response.ok || !payload.ok) {
    throw new Error(`${method}: ${payload.error ?? response.statusText}`);
  }
  return payload.value;
};

const buildGet = async (path) => {
  const response = await fetch(`${buildUrl}${path}`);
  const payload = await response.json().catch(() => {
    throw new Error(`build ${path}: response was not JSON`);
  });
  if (!response.ok || payload.ok === false) {
    throw new Error(`build ${path}: ${payload.error ?? response.statusText}`);
  }
  return payload;
};

const buildRpc = async (method, input) => {
  const response = await fetch(`${buildUrl}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, input })
  });
  const payload = await response.json().catch(() => {
    throw new Error(`build ${method}: response was not JSON`);
  });
  if (!response.ok || !payload.ok) {
    throw new Error(`build ${method}: ${payload.error ?? response.statusText}`);
  }
  return payload.value;
};

const check = async (name, fn) => {
  const startedAt = Date.now();
  try {
    const details = await fn();
    results.push({ name, ok: true, ms: Date.now() - startedAt, details });
  } catch (error) {
    results.push({
      name,
      ok: false,
      ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertArray = (value, message) => {
  assert(Array.isArray(value), message);
  return value;
};

const itemsFrom = (value, message) => {
  if (Array.isArray(value)) {
    return value;
  }
  if (Array.isArray(value?.items)) {
    return value.items;
  }
  throw new Error(message);
};

let state;
let snapshot;
let methods;
let createdPanelEvent;
let extensions;
let events;

await check("plastic/state", async () => {
  state = await rpc("plastic/state");
  assert(state && typeof state === "object", "plastic/state returned no object");
  assert(state.app?.name === "Plastic", "state.app.name is not Plastic");
  const panelResources = Array.isArray(state.panels)
    ? state.panels
    : assertArray(state.resources, "state.resources is not an array")
      .filter((resource) => resource.id === "panels" || resource.kind === "panel");
  assert(panelResources.length > 0, "state does not expose panels");
  assert(state.app.mode === "electron" || state.app.mode === "headless", "state.app.mode must identify the host");
  return { mode: state.app.mode, panels: panelResources.length, events: state.events?.count ?? null };
});

await check("plastic/methods", async () => {
  methods = await rpc("plastic/methods");
  const items = assertArray(methods, "plastic/methods is not an array");
  for (const id of [
    "plastic/state",
    "plastic/methods",
    "methods/describe",
    "runtime/capabilities",
    "agent/orient",
    "codex/status",
    "chats/getBinding",
    "chats/createCodexChat",
    "chats/sendToCodex",
    "panels/create",
    "extensions/list",
    "extensions/scaffold",
    "build/status",
    "app/diagnostics",
    "renderer/reload",
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
    "deixis/verifyRefAction",
    "events/append",
    "events/list",
    "events/timeline",
    "plastic/selfTest"
  ]) {
    assert(items.some((method) => method.id === id), `missing method ${id}`);
  }
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
  assert(snapshot.methods?.count >= 1, "snapshot.methods.count missing");
  assert(snapshot.events?.count >= 1, "snapshot.events.count missing");
  assert(snapshot.links?.some((link) => link.method === "runtime/capabilities"), "snapshot missing capabilities link");
  return {
    mode: snapshot.app.mode, methods: snapshot.methods.count, panels: snapshot.panels.length,
    windows: snapshot.windows.length, extensions: snapshot.extensions.length
  };
});

await check("methods/describe", async () => {
  const description = await rpc("methods/describe", { id: "panels/create" });
  assert(description.id === "panels/create", "described wrong method");
  assert(description.owner?.id, "method owner missing");
  return { id: description.id, owner: description.owner, availability: description.availability?.status ?? "unspecified" };
});

await check("runtime/capabilities", async () => {
  const capabilities = await rpc("runtime/capabilities");
  const items = assertArray(capabilities.items, "runtime/capabilities.items is not an array");
  const byId = Object.fromEntries(items.map((capability) => [capability.id, capability]));
  const shared = ["runtime.capabilities", "window.projection", "event.projection"];
  const host = ["electron.window", "dom.refs", "dom.eval", "dom.input", "screenshot", "agent.codex"];
  for (const id of [...shared, ...host]) assert(byId[id], `runtime/capabilities missing ${id}`);
  const expectedHostCapability = state.app.mode === "electron" ? "available" : "unavailable";
  for (const id of host) assert(byId[id].status === expectedHostCapability, `${id} status mismatch`);
  const description = await rpc("methods/describe", { id: "runtime/capabilities" });
  assert(description.availability?.status === "available", "runtime/capabilities availability mismatch");
  return { count: capabilities.count, hostCapabilityStatus: expectedHostCapability };
});

await check("agent/workbench", async () => {
  const workbench = await rpc("agent/workbench", { limit: 5 });
  assert(workbench?.app?.mode === state.app.mode, "workbench app mode does not match state");
  assert(workbench.control?.methodCount >= 1, "workbench method count missing");
  assertArray(workbench.control.recommendedActions, "workbench recommendedActions is not an array");
  assert(workbench.observability?.timeline, "workbench timeline missing");
  assert(workbench.workspace?.git, "workbench git status missing");
  return {
    mode: workbench.app.mode,
    methods: workbench.control.methodCount,
    actions: workbench.control.recommendedActions.length,
    visibleRefs: workbench.observability.visibleRefs?.length ?? 0
  };
});

await check("agent/orient", async () => {
  const orientation = await rpc("agent/orient", { panelId: "chat-main" });
  assert(orientation?.agent?.id, "agent/orient missing agent id");
  assert(orientation.embodiment?.projectDir, "agent/orient missing projectDir");
  assert(Array.isArray(orientation.capabilities?.recommendedActions), "agent/orient missing recommendedActions");
  assert(orientation.memory?.eventCount >= 1, "agent/orient missing event memory");
  return {
    agentId: orientation.agent.id,
    panelId: orientation.embodiment.panelId,
    visibleRefs: orientation.visibleContext?.visibleRefs?.length ?? 0,
    recommendedActions: orientation.capabilities.recommendedActions.length
  };
});

await check("agent backend metadata", async () => {
  const expectedAvailability = state.app.mode === "electron" ? "available" : "unavailable";
  const methodIds = ["codex/status", "chats/getBinding", "chats/createCodexChat", "chats/sendToCodex"];
  const descriptions = await Promise.all(
    methodIds.map((id) => rpc("methods/describe", { id }))
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
  assert(build?.status === "running", "build/status did not report running");
  assert(build.workspaceDir, "build/status missing workspaceDir");
  return {
    service: build.service,
    runtimeRpcUrl: build.runtimeRpcUrl ?? null,
    runtimePort: build.runtimePort ?? null
  };
});

await check("build HTTP transport", async () => {
  const health = await buildGet("/healthz");
  const status = await buildGet("/status");
  const buildSnapshot = await buildGet("/snapshot");
  const diagnostics = await buildRpc("app/diagnostics", {});
  assert(health.service === "plastic.build", "build /healthz returned wrong service");
  assert(status.value?.status === "running", "build /status did not report running");
  assert(buildSnapshot.value?.app?.mode === state.app.mode, "build /snapshot mode mismatch");
  assert(diagnostics?.workspaceDir, "build /rpc app/diagnostics missing workspaceDir");
  return {
    buildUrl,
    service: status.value.service,
    snapshotMode: buildSnapshot.value.app.mode,
    diagnosticsWindowCount: diagnostics.windowCount
  };
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

await check("panel lifecycle", async () => {
  createdPanelEvent = await rpc("panels/create", {
    id: panelId,
    title: "Contract Panel",
    kind: "generic",
    body: "Created by scripts/plastic-contract.mjs"
  });
  const panelsAfterCreate = await rpc("panels/list");
  assert(panelsAfterCreate.some((panel) => panel.id === panelId), "created panel not projected");
  const panel = await rpc("panels/get", { id: panelId });
  assert(panel.title === "Contract Panel", "created panel title mismatch");
  await rpc("panels/rename", { id: panelId, title: "Contract Panel Renamed" });
  const renamed = await rpc("panels/get", { id: panelId });
  assert(renamed.title === "Contract Panel Renamed", "renamed panel not projected");
  await rpc("panels/close", { id: panelId });
  const panelsAfterClose = await rpc("panels/list");
  assert(!panelsAfterClose.some((candidate) => candidate.id === panelId), "closed panel still projected");
  return {
    panelId,
    createEventId: createdPanelEvent.id,
    remainingPanels: panelsAfterClose.length
  };
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
