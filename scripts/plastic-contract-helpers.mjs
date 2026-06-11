export const rpcUrl = process.env.PLASTIC_RPC_URL ?? "http://127.0.0.1:7331/rpc";
export const runtimeUrl = rpcUrl.replace(/\/rpc$/, "");
export const buildUrl = process.env.PLASTIC_BUILD_URL ?? "http://127.0.0.1:7332";
export const results = [];

export const rpc = async (method, input) => {
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

export const getJson = async (baseUrl, path, label) => {
  const response = await fetch(`${baseUrl}${path}`);
  const payload = await response.json().catch(() => {
    throw new Error(`${label} ${path}: response was not JSON`);
  });
  if (!response.ok || payload.ok === false) {
    throw new Error(`${label} ${path}: ${payload.error ?? response.statusText}`);
  }
  return payload;
};

export const runtimeGet = (path) => getJson(runtimeUrl, path, "runtime");
export const buildGet = (path) => getJson(buildUrl, path, "build");

export const buildRpc = async (method, input) => {
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

const eventStream = async ({ baseUrl, label, trigger, timeoutMs = 5000 }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(`${baseUrl}/events/stream`, { signal: controller.signal });
  if (!response.ok || !response.body) {
    clearTimeout(timeout);
    throw new Error(`${label} /events/stream failed: ${response.statusText}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let ready = false;
  let event = false;
  try {
    while (!event) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
      if (!ready && text.includes("event: plastic.ready")) {
        ready = true;
        await trigger();
      }
      event = text.includes("event: plastic.event");
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
    await reader.cancel().catch(() => {});
  }
  return { ready, event };
};

export const runtimeEventStream = (input) => eventStream({ ...input, baseUrl: runtimeUrl, label: "runtime" });
export const buildEventStream = (input) => eventStream({ ...input, baseUrl: buildUrl, label: "build" });

export const check = async (name, fn) => {
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

export const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

export const assertArray = (value, message) => {
  assert(Array.isArray(value), message);
  return value;
};

export const assertControlPlaneEndpointUrls = ({ controlPlane, source }) => {
  assert(controlPlane?.runtime?.baseUrl?.startsWith("http://"), `${source} runtime baseUrl missing`);
  assert(controlPlane.runtime.rpcUrl === `${controlPlane.runtime.baseUrl}${controlPlane.runtime.rpcPath}`, `${source} runtime rpcUrl mismatch`);
  assert(controlPlane.runtime.stateUrl === `${controlPlane.runtime.baseUrl}${controlPlane.runtime.statePath}`, `${source} runtime stateUrl mismatch`);
  assert(controlPlane.runtime.methodsUrl === `${controlPlane.runtime.baseUrl}${controlPlane.runtime.methodsPath}`, `${source} runtime methodsUrl mismatch`);
  assert(controlPlane.runtime.eventStreamUrl === `${controlPlane.runtime.baseUrl}${controlPlane.runtime.eventStreamPath}`, `${source} runtime eventStreamUrl mismatch`);
  assert(controlPlane.runtime.healthUrl === `${controlPlane.runtime.baseUrl}${controlPlane.runtime.healthPath}`, `${source} runtime healthUrl mismatch`);
  assert(controlPlane?.build?.baseUrl?.startsWith("http://"), `${source} build baseUrl missing`);
  assert(controlPlane.build.rpcUrl === `${controlPlane.build.baseUrl}${controlPlane.build.rpcPath}`, `${source} build rpcUrl mismatch`);
  assert(controlPlane.build.stateUrl === `${controlPlane.build.baseUrl}${controlPlane.build.statePath}`, `${source} build stateUrl mismatch`);
  assert(controlPlane.build.methodsUrl === `${controlPlane.build.baseUrl}${controlPlane.build.methodsPath}`, `${source} build methodsUrl mismatch`);
  assert(controlPlane.build.eventStreamUrl === `${controlPlane.build.baseUrl}${controlPlane.build.eventStreamPath}`, `${source} build eventStreamUrl mismatch`);
  assert(controlPlane.build.healthUrl === `${controlPlane.build.baseUrl}${controlPlane.build.healthPath}`, `${source} build healthUrl mismatch`);
  assert(controlPlane.build.statusUrl === `${controlPlane.build.baseUrl}${controlPlane.build.statusPath}`, `${source} build statusUrl mismatch`);
  assert(controlPlane.build.snapshotUrl === `${controlPlane.build.baseUrl}${controlPlane.build.snapshotPath}`, `${source} build snapshotUrl mismatch`);
};

export const assertMethodDiscoveryParity = async ({ methods, rpc, sampleIds }) => {
  const byId = Object.fromEntries(methods.map((method) => [method.id, method]));
  for (const id of sampleIds) {
    const listed = byId[id];
    assert(listed, `plastic/methods missing ${id}`);
    const described = await rpc("methods/describe", { id });
    assert(described.id === listed.id, `${id} describe id mismatch`);
    assert(described.title === listed.title, `${id} describe title mismatch`);
    assert(described.owner?.kind === listed.owner?.kind, `${id} describe owner kind mismatch`);
    assert(described.owner?.id === listed.owner?.id, `${id} describe owner id mismatch`);
    assert(
      described.availability?.status === listed.availability?.status,
      `${id} describe availability mismatch`
    );
  }
};

export const assertMethodLegibility = ({ methods, ids }) => {
  const byId = Object.fromEntries(methods.map((method) => [method.id, method]));
  for (const id of ids) {
    const method = byId[id];
    assert(method, `plastic/methods missing ${id}`);
    assert(method.description, `${id} missing description`);
    assert(method.inputSchema, `${id} missing inputSchema`);
    assert(Array.isArray(method.examples) && method.examples.length > 0, `${id} missing examples`);
    assert(method.effects?.durableEvents?.length > 0, `${id} missing durable event effects`);
    assert(method.effects?.mutatesProjection?.length > 0, `${id} missing projection effects`);
    assert(method.reversibility?.reversible !== undefined, `${id} missing reversibility`);
  }
};

export const assertReadMethodLegibility = ({ methods, ids }) => {
  const byId = Object.fromEntries(methods.map((method) => [method.id, method]));
  for (const id of ids) {
    const method = byId[id];
    assert(method, `plastic/methods missing ${id}`);
    assert(method.description, `${id} missing description`);
    assert(method.inputSchema, `${id} missing inputSchema`);
    assert(Array.isArray(method.examples) && method.examples.length > 0, `${id} missing examples`);
    assert(Array.isArray(method.effects?.durableEvents), `${id} missing durable event effects`);
    assert(Array.isArray(method.effects?.mutatesProjection), `${id} missing projection effects`);
    assert(method.effects.durableEvents.length === 0, `${id} should not append durable events`);
    assert(method.effects.mutatesProjection.length === 0, `${id} should not mutate projections`);
    assert(method.reversibility?.reversible === true, `${id} should be marked reversible/read-only`);
  }
};

export const assertPassthroughMethodLegibility = ({ methods, ids }) => {
  const byId = Object.fromEntries(methods.map((method) => [method.id, method]));
  for (const id of ids) {
    const method = byId[id];
    assert(method, `plastic/methods missing ${id}`);
    assert(method.description, `${id} missing description`);
    assert(method.inputSchema, `${id} missing inputSchema`);
    assert(Array.isArray(method.examples) && method.examples.length > 0, `${id} missing examples`);
    assert(Array.isArray(method.effects?.durableEvents), `${id} missing durable event effects`);
    assert(Array.isArray(method.effects?.mutatesProjection), `${id} missing projection effects`);
    assert(method.reversibility?.reversible === false, `${id} should describe delegated reversibility`);
  }
};

export const assertControlLegibilityAndThemeProjection = async ({ methods, rpc }) => {
  assertMethodLegibility({
    methods,
    ids: ["panels/create", "panels/rename", "panels/move", "panels/close", "app/setTheme", "events/append", "plastic/selfTest", "build/typecheck", "extensions/scan", "extensions/scaffold", "extensions/activate", "extensions/verify", "extensions/verifyAll", "extensions/registerPanel", "extensions/forkBundled", "panels/sendMessage", "panels/markMessageRead", "chats/createCodexChat", "chats/sendToCodex", "codex/setDefaults", "bridge/configurePlasticMcp", "bridge/test", "bridge/callPlasticRpcTool"]
  });
  assertReadMethodLegibility({ methods, ids: ["events/list", "events/timeline"] });
  assertReadMethodLegibility({ methods, ids: ["plastic/methods", "methods/describe", "runtime/capabilities", "runtime/modules"] });
  assertReadMethodLegibility({ methods, ids: ["plastic/state", "plastic/snapshot"] });
  assertReadMethodLegibility({ methods, ids: ["agent/orient", "agent/workbench"] });
  assertReadMethodLegibility({ methods, ids: ["app/diagnostics", "build/status"] });
  assertReadMethodLegibility({ methods, ids: ["extensions/list", "extensions/get"] });
  assertReadMethodLegibility({ methods, ids: ["extensions/verificationStatus"] });
  assertReadMethodLegibility({ methods, ids: ["panels/listMessages", "panels/mailboxes"] });
  assertReadMethodLegibility({ methods, ids: ["chats/getBinding"] });
  assertReadMethodLegibility({ methods, ids: ["codex/status", "codex/defaults"] });
  assertReadMethodLegibility({ methods, ids: ["bridge/status"] });
  assertPassthroughMethodLegibility({ methods, ids: ["codex/request", "codex/threadStart", "codex/turnStart", "codex/modelList"] });
  const darkEvent = await rpc("app/setTheme", { theme: "dark" });
  assert(darkEvent?.type === "theme.changed", "app/setTheme did not append theme.changed");
  const darkState = await rpc("plastic/state");
  assert(darkState.app?.theme === "dark", "dark theme did not project into plastic/state");
  const lightEvent = await rpc("app/setTheme", { theme: "light" });
  assert(lightEvent?.type === "theme.changed", "app/setTheme light did not append theme.changed");
  const lightState = await rpc("plastic/state");
  assert(lightState.app?.theme === "light", "light theme did not project into plastic/state");
  return { methods: 6, events: [darkEvent.id, lightEvent.id], theme: lightState.app.theme };
};

export const assertPanelLifecycleProjection = async ({ rpc, panelId }) => {
  const created = await rpc("panels/create", {
    id: panelId,
    title: "Contract Panel",
    kind: "generic",
    body: "Created by scripts/plastic-contract.mjs",
    order: 10
  });
  const panelsAfterCreate = await rpc("panels/list");
  assert(panelsAfterCreate.some((panel) => panel.id === panelId), "created panel not projected");
  const panel = await rpc("panels/get", { id: panelId });
  assert(panel.title === "Contract Panel", "created panel title mismatch");
  await rpc("panels/rename", { id: panelId, title: "Contract Panel Renamed" });
  const renamed = await rpc("panels/get", { id: panelId });
  assert(renamed.title === "Contract Panel Renamed", "renamed panel not projected");
  await rpc("panels/move", { id: panelId, order: 1 });
  const moved = await rpc("panels/get", { id: panelId });
  assert(moved.order === 1, "moved panel order not projected");
  await rpc("panels/close", { id: panelId });
  const panelsAfterClose = await rpc("panels/list");
  assert(!panelsAfterClose.some((candidate) => candidate.id === panelId), "closed panel still projected");
  return { id: created.id, panelId, createEventId: created.id, remainingPanels: panelsAfterClose.length };
};

export const assertRpcCallDispatch = async ({ rpc }) => {
  const panels = await rpc("rpc/call", { method: "panels/list", input: {} });
  assert(Array.isArray(panels), "rpc/call panels/list did not return panel array");
  try {
    await rpc("rpc/call", { method: "rpc/call", input: {} });
    throw new Error("rpc/call unexpectedly called itself");
  } catch (error) {
    assert(String(error.message ?? error).includes("cannot call itself"), "rpc/call self-call error mismatch");
  }
  return { delegatedMethod: "panels/list", panels: panels.length };
};

export const assertRuntimeModuleInventory = async ({ rpc }) => {
  const modules = await rpc("runtime/modules");
  const items = assertArray(modules.items, "runtime/modules.items is not an array");
  const ids = items.map((module) => module.id);
  for (const id of [
    "runtime-state", "runtime-snapshot", "agent-workbench", "agent-orient", "runtime-build",
    "runtime-diagnostics", "extension-authoring", "renderer-control", "runtime-control",
    "panel-control", "window-capability", "deixis", "runtime-health", "extension-runtime", "panel-mailbox",
    "runtime-modules"
  ]) {
    assert(ids.includes(id), `runtime/modules missing ${id}`);
  }
  assert(
    ids.some((id) => id === "agent-backend-codex" || id === "agent-backend-fallback"),
    "runtime/modules missing an agent backend module"
  );
  assert(items.every((module, index) => module.order === index), "runtime/modules order is not stable");
  assertModuleMethodMap(items, "runtime/modules");
  return { count: modules.count, ids, items };
};

export const assertRuntimeCapabilityInventory = async ({ rpc }) => {
  const capabilities = await rpc("runtime/capabilities");
  const items = assertArray(capabilities.items, "runtime/capabilities.items is not an array");
  const ids = items.map((capability) => capability.id);
  for (const id of [
    "runtime.capabilities", "window.projection", "event.projection", "electron.window",
    "dom.refs", "dom.eval", "dom.input", "screenshot", "agent.codex"
  ]) {
    assert(ids.includes(id), `runtime/capabilities missing ${id}`);
  }
  assert(items.every((capability) => ["available", "degraded", "unavailable"].includes(capability.status)), "runtime/capabilities has invalid status");
  return { count: capabilities.count, ids, items };
};

export const assertRuntimeStartedCapabilityInventory = async ({ rpc }) => {
  const events = await rpc("events/list", { types: ["runtime.started"], limit: 5 });
  const items = itemsFrom(events, "runtime.started events/list returned no items");
  const latest = items.at(-1);
  assert(latest, "runtime.started event missing");
  const capabilities = latest.payload?.capabilities;
  assert(Array.isArray(capabilities), "runtime.started missing capability inventory");
  const ids = capabilities.map((capability) => capability.id);
  for (const id of ["runtime.capabilities", "electron.window", "agent.codex"]) {
    assert(ids.includes(id), `runtime.started capability inventory missing ${id}`);
  }
  return { eventId: latest.id, count: capabilities.length, ids, items: capabilities };
};

export const assertRuntimeStartedControlPlane = async ({ rpc }) => {
  const events = await rpc("events/list", { types: ["runtime.started"], limit: 5 });
  const items = itemsFrom(events, "runtime.started events/list returned no items");
  const latest = items.at(-1);
  assert(latest, "runtime.started event missing");
  const controlPlane = latest.payload?.controlPlane;
  assert(controlPlane?.runtime?.transport === "http", "runtime.started missing runtime HTTP transport");
  assert(controlPlane.runtime.rpcPath === "/rpc", "runtime.started runtime rpcPath mismatch");
  assert(controlPlane.runtime.statePath === "/state", "runtime.started runtime statePath mismatch");
  assert(controlPlane.runtime.methodsPath === "/methods", "runtime.started runtime methodsPath mismatch");
  assert(controlPlane.runtime.eventStreamPath === "/events/stream", "runtime.started runtime event stream path mismatch");
  assert(controlPlane.runtime.healthPath === "/healthz", "runtime.started runtime health path mismatch");
  assert(controlPlane?.build?.transport === "http", "runtime.started missing build HTTP transport");
  assert(controlPlane.build.rpcPath === "/rpc", "runtime.started build rpcPath mismatch");
  assert(controlPlane.build.statePath === "/state", "runtime.started build statePath mismatch");
  assert(controlPlane.build.methodsPath === "/methods", "runtime.started build methodsPath mismatch");
  assert(controlPlane.build.eventStreamPath === "/events/stream", "runtime.started build event stream path mismatch");
  assert(controlPlane.build.statusPath === "/status", "runtime.started build status path mismatch");
  assert(controlPlane.build.snapshotPath === "/snapshot", "runtime.started build snapshot path mismatch");
  assertControlPlaneEndpointUrls({ controlPlane, source: "runtime.started" });
  return {
    eventId: latest.id,
    runtime: controlPlane.runtime,
    build: controlPlane.build
  };
};

export const assertMatchingCapabilityInventories = ({ live, durable }) => {
  assert(live.count === durable.count, "runtime/capabilities live and durable counts diverged");
  assert(
    JSON.stringify(capabilityPairs(live.items)) === JSON.stringify(capabilityPairs(durable.items)),
    "runtime/capabilities live and durable items diverged"
  );
};

export const assertMatchingModuleInventories = ({ live, durable }) => {
  assert(live.count === durable.count, "runtime/modules live and durable counts diverged");
  assert(
    JSON.stringify(live.ids) === JSON.stringify(durable.ids),
    "runtime/modules live and durable ids diverged"
  );
  assert(
    JSON.stringify(moduleMethodPairs(live.items)) === JSON.stringify(moduleMethodPairs(durable.items)),
    "runtime/modules live and durable method contributions diverged"
  );
  assert(
    JSON.stringify(moduleAvailabilityPairs(live.items)) === JSON.stringify(moduleAvailabilityPairs(durable.items)),
    "runtime/modules live and durable availability summaries diverged"
  );
};

export const assertRuntimeStartedModuleInventory = async ({ rpc }) => {
  const events = await rpc("events/list", { types: ["runtime.started"], limit: 5 });
  const items = itemsFrom(events, "runtime.started events/list returned no items");
  const latest = items.at(-1);
  assert(latest, "runtime.started event missing");
  const modules = latest.payload?.modules;
  assert(Array.isArray(modules), "runtime.started missing module inventory");
  assert(latest.payload?.beforeStarted === undefined, "runtime.started should not expose beforeStarted side-channel state");
  const ids = modules.map((module) => module.id);
  for (const id of ["runtime-state", "runtime-control", "extension-runtime", "panel-mailbox", "runtime-modules"]) {
    assert(ids.includes(id), `runtime.started module inventory missing ${id}`);
  }
  assert(
    ids.some((id) => id === "agent-backend-codex" || id === "agent-backend-fallback"),
    "runtime.started module inventory missing an agent backend module"
  );
  assertModuleMethodMap(modules, "runtime.started");
  return { eventId: latest.id, count: modules.length, ids, items: modules };
};

export const assertAgentWorkbenchPacket = ({ workbench, mode }) => {
  assert(workbench?.app?.mode === mode, "workbench app mode does not match state");
  assert(workbench.control?.methodCount >= 1, "workbench method count missing");
  assert(workbench.control.capabilities?.count >= 1, "workbench capabilities count missing");
  assertArray(workbench.control.capabilities.items, "workbench capabilities items missing");
  assert(workbench.control.modules?.count >= 1, "workbench runtime module count missing");
  assertArray(workbench.control.modules.items, "workbench runtime modules items missing");
  assert(workbench.control.controlPlane?.runtime?.transport === "http", "workbench missing runtime control plane");
  assert(workbench.control.controlPlane.runtime.rpcPath === "/rpc", "workbench runtime control plane rpcPath mismatch");
  assert(workbench.control.controlPlane.runtime.statePath === "/state", "workbench runtime control plane statePath mismatch");
  assert(workbench.control.controlPlane.runtime.methodsPath === "/methods", "workbench runtime control plane methodsPath mismatch");
  assert(workbench.control.controlPlane?.build?.transport === "http", "workbench missing build control plane");
  assert(workbench.control.controlPlane.build.rpcPath === "/rpc", "workbench build control plane rpcPath mismatch");
  assert(workbench.control.controlPlane.build.statePath === "/state", "workbench build control plane statePath mismatch");
  assert(workbench.control.controlPlane.build.methodsPath === "/methods", "workbench build control plane methodsPath mismatch");
  assert(workbench.control.controlPlane.build.eventStreamPath === "/events/stream", "workbench build control plane eventStreamPath mismatch");
  assertControlPlaneEndpointUrls({ controlPlane: workbench.control.controlPlane, source: "workbench" });
  assertArray(workbench.control.recommendedActions, "workbench recommendedActions is not an array");
  assert(
    workbench.control.recommendedActions.some((action) => action.method === "runtime/modules"),
    "workbench missing runtime/modules recommended action"
  );
  assert(
    workbench.control.recommendedActions.some((action) =>
      action.method === "events/list" && action.input?.types?.includes("runtime.started")
    ),
    "workbench missing control plane recommended action"
  );
  assert(workbench.observability?.timeline, "workbench timeline missing");
  assert(workbench.workspace?.git, "workbench git status missing");
  return {
    mode: workbench.app.mode,
    methods: workbench.control.methodCount,
    capabilities: workbench.control.capabilities.count,
    modules: workbench.control.modules.count,
    controlPlane: workbench.control.controlPlane.runtime.transport,
    actions: workbench.control.recommendedActions.length,
    visibleRefs: workbench.observability.visibleRefs?.length ?? 0
  };
};

export const assertAgentOrientationPacket = (orientation) => {
  assert(orientation?.agent?.id, "agent/orient missing agent id");
  assert(orientation.embodiment?.projectDir, "agent/orient missing projectDir");
  assert(orientation.capabilities.host?.count >= 1, "agent/orient missing host capability count");
  assertArray(orientation.capabilities.host.items, "agent/orient host capabilities missing");
  assertArray(orientation.capabilities?.recommendedActions, "agent/orient missing recommendedActions");
  assert(orientation.capabilities.modules?.count >= 1, "agent/orient missing runtime module count");
  assertArray(orientation.capabilities.modules.items, "agent/orient runtime modules missing");
  assert(orientation.capabilities.controlPlane?.runtime?.transport === "http", "agent/orient missing runtime control plane");
  assert(orientation.capabilities.controlPlane.runtime.rpcPath === "/rpc", "agent/orient runtime control plane rpcPath mismatch");
  assert(orientation.capabilities.controlPlane.runtime.statePath === "/state", "agent/orient runtime control plane statePath mismatch");
  assert(orientation.capabilities.controlPlane.runtime.methodsPath === "/methods", "agent/orient runtime control plane methodsPath mismatch");
  assert(orientation.capabilities.controlPlane?.build?.transport === "http", "agent/orient missing build control plane");
  assert(orientation.capabilities.controlPlane.build.rpcPath === "/rpc", "agent/orient build control plane rpcPath mismatch");
  assert(orientation.capabilities.controlPlane.build.statePath === "/state", "agent/orient build control plane statePath mismatch");
  assert(orientation.capabilities.controlPlane.build.methodsPath === "/methods", "agent/orient build control plane methodsPath mismatch");
  assert(orientation.capabilities.controlPlane.build.eventStreamPath === "/events/stream", "agent/orient build control plane eventStreamPath mismatch");
  assertControlPlaneEndpointUrls({ controlPlane: orientation.capabilities.controlPlane, source: "agent/orient" });
  assert(
    orientation.capabilities.links?.some((link) => link.method === "runtime/modules"),
    "agent/orient missing runtime/modules link"
  );
  assert(
    orientation.capabilities.links?.some((link) =>
      link.rel === "control-plane" && link.method === "events/list"
    ),
    "agent/orient missing control plane link"
  );
  assert(orientation.memory?.eventCount >= 1, "agent/orient missing event memory");
  return {
    agentId: orientation.agent.id,
    panelId: orientation.embodiment.panelId,
    capabilities: orientation.capabilities.host.count,
    modules: orientation.capabilities.modules.count,
    controlPlane: orientation.capabilities.controlPlane.runtime.transport,
    visibleRefs: orientation.visibleContext?.visibleRefs?.length ?? 0,
    recommendedActions: orientation.capabilities.recommendedActions.length
  };
};

const assertModuleMethodMap = (items, source) => {
  for (const module of items) {
    assert(Array.isArray(module.methodIds), `${source} ${module.id} missing methodIds`);
  }
  const byId = Object.fromEntries(items.map((module) => [module.id, module]));
  assert(byId["runtime-control"]?.methodIds.includes("plastic/methods"), `${source} runtime-control missing plastic/methods`);
  assert(byId["panel-control"]?.methodIds.includes("panels/create"), `${source} panel-control missing panels/create`);
  assert(byId["runtime-modules"]?.methodIds.includes("runtime/modules"), `${source} runtime-modules missing runtime/modules`);
  for (const module of items) {
    assert(typeof module.availability?.available === "number", `${source} ${module.id} missing available count`);
    assert(typeof module.availability?.degraded === "number", `${source} ${module.id} missing degraded count`);
    assert(typeof module.availability?.unavailable === "number", `${source} ${module.id} missing unavailable count`);
    assert(Array.isArray(module.availability.requiredCapabilities), `${source} ${module.id} missing required capabilities`);
    assert(Array.isArray(module.availability.missingCapabilities), `${source} ${module.id} missing missing capabilities`);
  }
};

const moduleMethodPairs = (items) =>
  items.map((module) => ({
    id: module.id,
    order: module.order,
    methodIds: module.methodIds
  }));

const moduleAvailabilityPairs = (items) =>
  items.map((module) => ({
    id: module.id,
    availability: module.availability
  }));

const capabilityPairs = (items) =>
  items.map((capability) => ({
    id: capability.id,
    title: capability.title,
    status: capability.status,
    notes: capability.notes ?? null
  }));

export const itemsFrom = (value, message) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  throw new Error(message);
};
