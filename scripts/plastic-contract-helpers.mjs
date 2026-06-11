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

export const rawRuntimeRequest = async (path, init = {}) => {
  const response = await fetch(`${runtimeUrl}${path}`, init);
  const text = await response.text();
  let payload = {};
  if (text.trim().length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`runtime ${path}: response was not JSON`);
    }
  }
  return { response, payload };
};

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

export const runtimeEventStream = async ({ trigger, timeoutMs = 5000 }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(`${runtimeUrl}/events/stream`, { signal: controller.signal });
  if (!response.ok || !response.body) {
    clearTimeout(timeout);
    throw new Error(`runtime /events/stream failed: ${response.statusText}`);
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

export const itemsFrom = (value, message) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  throw new Error(message);
};
