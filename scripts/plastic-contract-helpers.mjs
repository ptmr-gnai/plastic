import { assertControlPlaneEndpointUrls } from "./plastic-contract-control-plane.mjs";
import { assertChatMethodDescriptions } from "./plastic-contract-chat.mjs";
import { assertCodexBridgeMethodDescriptions, assertCodexCoreMethodDescriptions } from "./plastic-contract-codex.mjs";
import { assertExtensionLifecycleMethodDescriptions, assertExtensionQueryMethodDescriptions, assertExtensionVerificationMethodDescriptions } from "./plastic-contract-extensions.mjs";
import { assertSetThemeMethodDescription } from "./plastic-contract-events.mjs";
import { assertPanelMailboxMethodDescriptions } from "./plastic-contract-panel-mailbox.mjs";
import { assertPanelControlMethodDescriptions } from "./plastic-contract-panels.mjs";
import { capabilityExpectationsForMode } from "./plastic-capability-expectations.mjs";
import { stableJson } from "./plastic-stable-json.mjs";
export { assertRuntimeAuditStatus } from "./plastic-contract-audit-status.mjs";

export const rpcUrl = process.env.PLASTIC_RPC_URL ?? "http://127.0.0.1:7331/rpc", runtimeUrl = rpcUrl.replace(/\/rpc$/, ""), buildUrl = process.env.PLASTIC_BUILD_URL ?? "http://127.0.0.1:7332", results = [];

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

export const runtimeGet = (path) => getJson(runtimeUrl, path, "runtime"), buildGet = (path) => getJson(buildUrl, path, "build");

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
  let deliveredEvent = null;
  let triggeredEvent = null;
  try {
    while (!event) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
      if (!ready && text.includes("event: plastic.ready")) {
        ready = true;
        triggeredEvent = await trigger();
      }
      deliveredEvent = parseLastSseData(text, "plastic.event");
      event = deliveredEvent !== null;
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
    await reader.cancel().catch(() => {});
  }
  return {
    ready, event, triggeredEventId: triggeredEvent?.id ?? null,
    deliveredEventId: deliveredEvent?.id ?? null, deliveredType: deliveredEvent?.type ?? null
  };
};

const parseLastSseData = (text, eventName) => {
  for (const event of text.split("\n\n").filter(Boolean).reverse()) {
    if (!event.includes(`event: ${eventName}`)) continue;
    const data = event.split("\n").find((line) => line.startsWith("data: "))?.slice("data: ".length);
    if (!data) return null;
    try { return JSON.parse(data); } catch { return null; }
  }
  return null;
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

export const assertEventsTagged = (events, tags, message) => {
  assert(events.every((event) => tags.every((tag) => event.meta?.tags?.includes(tag))), message);
};

export const assertMethodDiscoveryParity = async ({ methods, rpc }) => {
  const byId = Object.fromEntries(methods.map((method) => [method.id, method]));
  for (const id of methods.map((method) => method.id)) {
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
    assert(stableJson(described.inputSchema) === stableJson(listed.inputSchema), `${id} describe inputSchema mismatch`);
    assert(stableJson(described.outputSchema) === stableJson(listed.outputSchema), `${id} describe outputSchema mismatch`);
    assert(stableJson(described.examples) === stableJson(listed.examples), `${id} describe examples mismatch`);
    assert(stableJson(described.effects) === stableJson(listed.effects), `${id} describe effects mismatch`);
    assert(stableJson(described.reversibility) === stableJson(listed.reversibility), `${id} describe reversibility mismatch`);
    assert(stableJson(described.links) === stableJson(listed.links), `${id} describe links mismatch`);
  }
};

export const assertModuleMethodDiscoveryParity = async ({ methods, modules, rpc }) => {
  const byId = Object.fromEntries(methods.map((method) => [method.id, method]));
  const moduleMethodIds = modules.items.flatMap((module) => module.methodIds);
  const missingFromMethods = moduleMethodIds.filter((id) => !byId[id]);
  assert(missingFromMethods.length === 0, `runtime/modules references unknown methods: ${missingFromMethods.join(", ")}`);
  const uncovered = methods.map((method) => method.id).filter((id) => !moduleMethodIds.includes(id));
  assert(uncovered.length === 0, `plastic/methods has methods missing from runtime/modules: ${uncovered.join(", ")}`);
  for (const id of moduleMethodIds) {
    const described = await rpc("methods/describe", { id });
    const listed = byId[id];
    assert(stableJson(described) === stableJson(listed), `${id} describe metadata diverged from plastic/methods`);
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
    ids: ["panels/create", "panels/rename", "panels/move", "panels/close", "app/setTheme", "events/append", "plastic/selfTest", "build/typecheck", "runtime/runAuditAction", "extensions/scan", "extensions/scaffold", "extensions/activate", "extensions/verify", "extensions/verifyAll", "extensions/registerPanel", "extensions/forkBundled", "panels/sendMessage", "panels/markMessageRead", "chats/createCodexChat", "chats/sendToCodex", "codex/setDefaults", "bridge/configurePlasticMcp", "bridge/test", "bridge/callPlasticRpcTool"]
  });
  assertReadMethodLegibility({ methods, ids: ["events/list", "events/timeline"] });
  assertReadMethodLegibility({ methods, ids: ["plastic/methods", "methods/describe", "runtime/capabilities", "runtime/modules"] });
  assertReadMethodLegibility({ methods, ids: ["plastic/state", "plastic/snapshot"] });
  assertReadMethodLegibility({ methods, ids: ["agent/orient", "agent/workbench"] });
  assertReadMethodLegibility({ methods, ids: ["app/diagnostics", "build/status", "runtime/auditStatus", "runtime/auditActionPlan"] });
  assertReadMethodLegibility({ methods, ids: ["extensions/list", "extensions/get"] });
  assertExtensionQueryMethodDescriptions({ assert, descriptions: Object.fromEntries(await Promise.all(["scan", "list", "get"].map(async (key) => [key, await rpc("methods/describe", { id: `extensions/${key}` })]))) });
  assertExtensionLifecycleMethodDescriptions({ assert, descriptions: Object.fromEntries(await Promise.all([["scaffold", "extensions/scaffold"], ["activate", "extensions/activate"], ["registerPanel", "extensions/registerPanel"], ["forkBundled", "extensions/forkBundled"]].map(async ([key, id]) => [key, await rpc("methods/describe", { id })]))) });
  assertReadMethodLegibility({ methods, ids: ["extensions/verificationStatus"] });
  assertExtensionVerificationMethodDescriptions({ assert, descriptions: Object.fromEntries(await Promise.all([["verify", "extensions/verify"], ["verifyAll", "extensions/verifyAll"], ["status", "extensions/verificationStatus"]].map(async ([key, id]) => [key, await rpc("methods/describe", { id })]))) });
  assertReadMethodLegibility({ methods, ids: ["panels/listMessages", "panels/mailboxes"] });
  assertReadMethodLegibility({ methods, ids: ["chats/getBinding"] });
  assertChatMethodDescriptions({ assert, descriptions: Object.fromEntries(await Promise.all([["binding", "chats/getBinding"], ["bind", "chats/bindCodexThread"], ["start", "chats/startCodexThread"], ["create", "chats/createCodexChat"], ["interrupt", "chats/interrupt"], ["close", "chats/close"], ["send", "chats/sendToCodex"]].map(async ([key, id]) => [key, await rpc("methods/describe", { id })]))) });
  assertReadMethodLegibility({ methods, ids: ["codex/status", "codex/defaults"] });
  assertCodexCoreMethodDescriptions({ assert, descriptions: Object.fromEntries(await Promise.all([["status", "codex/status"], ["defaults", "codex/defaults"], ["setDefaults", "codex/setDefaults"], ["connect", "codex/connect"], ["initialize", "codex/initialize"], ["request", "codex/request"], ["threadStart", "codex/threadStart"], ["turnStart", "codex/turnStart"], ["modelList", "codex/modelList"]].map(async ([key, id]) => [key, await rpc("methods/describe", { id })]))) });
  assertReadMethodLegibility({ methods, ids: ["bridge/status"] });
  assertCodexBridgeMethodDescriptions({ assert, descriptions: Object.fromEntries(await Promise.all([["configure", "bridge/configurePlasticMcp"], ["status", "bridge/status"], ["test", "bridge/test"], ["call", "bridge/callPlasticRpcTool"]].map(async ([key, id]) => [key, await rpc("methods/describe", { id })]))) });
  assertPassthroughMethodLegibility({ methods, ids: ["codex/request", "codex/threadStart", "codex/turnStart", "codex/modelList"] });
  assertSetThemeMethodDescription({ assert, description: await rpc("methods/describe", { id: "app/setTheme" }) });
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

export const assertPanelLifecycleProjection = async ({ rpc, panelId, meta }) => {
  const panelDescriptions = Object.fromEntries(await Promise.all(
    ["list", "get", "create", "rename", "move", "close"].map(async (key) => [
      key,
      await rpc("methods/describe", { id: `panels/${key}` })
    ])
  ));
  assertPanelControlMethodDescriptions({ assert, descriptions: panelDescriptions });
  const created = await rpc("panels/create", {
    id: panelId,
    title: "Contract Panel",
    kind: "generic",
    body: "Created by scripts/plastic-contract.mjs",
    order: 10,
    ...(meta ? { meta } : {})
  });
  const panelsAfterCreate = await rpc("panels/list");
  assert(panelsAfterCreate.some((panel) => panel.id === panelId), "created panel not projected");
  const panel = await rpc("panels/get", { id: panelId });
  assert(panel.title === "Contract Panel", "created panel title mismatch");
  await rpc("panels/rename", { id: panelId, title: "Contract Panel Renamed", ...(meta ? { meta } : {}) });
  const renamed = await rpc("panels/get", { id: panelId });
  assert(renamed.title === "Contract Panel Renamed", "renamed panel not projected");
  await rpc("panels/move", { id: panelId, order: 1, ...(meta ? { meta } : {}) });
  const moved = await rpc("panels/get", { id: panelId });
  assert(moved.order === 1, "moved panel order not projected");
  await rpc("panels/close", { id: panelId, ...(meta ? { meta } : {}) });
  const panelsAfterClose = await rpc("panels/list");
  assert(!panelsAfterClose.some((candidate) => candidate.id === panelId), "closed panel still projected");
  const mailbox = await assertPanelMailboxProjection({ rpc, panelIdPrefix: panelId, meta });
  return { id: created.id, panelId, createEventId: created.id, remainingPanels: panelsAfterClose.length, mailbox };
};

const assertPanelMailboxProjection = async ({ rpc, panelIdPrefix, meta }) => {
  const fromPanelId = `${panelIdPrefix}-mailbox-from`;
  const toPanelId = `${panelIdPrefix}-mailbox-to`;
  const descriptions = Object.fromEntries(await Promise.all([
    ["send", "panels/sendMessage"],
    ["list", "panels/listMessages"],
    ["markRead", "panels/markMessageRead"],
    ["mailboxes", "panels/mailboxes"]
  ].map(async ([key, id]) => [key, await rpc("methods/describe", { id })])));
  assertPanelMailboxMethodDescriptions({ assert, descriptions });
  await rpc("panels/create", { id: fromPanelId, title: "Mailbox Sender", kind: "generic", ...(meta ? { meta } : {}) });
  await rpc("panels/create", { id: toPanelId, title: "Mailbox Receiver", kind: "generic", ...(meta ? { meta } : {}) });
  const sent = await rpc("panels/sendMessage", { fromPanelId, toPanelId, content: "contract mailbox message" });
  assert(sent?.type === "panel.message.sent", "panels/sendMessage did not append panel.message.sent");
  const messages = await rpc("panels/listMessages", { panelId: toPanelId });
  const message = messages.find((candidate) => candidate.id === sent.payload?.id);
  assert(message?.status === "sent", "sent panel message not projected");
  const read = await rpc("panels/markMessageRead", { id: message.id });
  assert(read?.type === "panel.message.read", "panels/markMessageRead did not append panel.message.read");
  const readMessages = await rpc("panels/listMessages", { panelId: toPanelId });
  assert(readMessages.find((candidate) => candidate.id === message.id)?.status === "read", "read receipt not projected");
  const mailboxes = await rpc("panels/mailboxes");
  assert(mailboxes.some((mailbox) => mailbox.panel?.id === toPanelId && mailbox.inboxCount >= 1), "mailbox inbox count not projected");
  await rpc("panels/close", { id: fromPanelId, ...(meta ? { meta } : {}) });
  await rpc("panels/close", { id: toPanelId, ...(meta ? { meta } : {}) });
  return { sentEventId: sent.id, readEventId: read.id, messageId: message.id };
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
    "runtime-host", "runtime-modules"
  ]) {
    assert(ids.includes(id), `runtime/modules missing ${id}`);
  }
  assert(ids.includes("agent-backend"), "runtime/modules missing agent-backend");
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

export const assertCapabilityStatuses = ({ items, mode }) => {
  const byId = Object.fromEntries(items.map((capability) => [capability.id, capability]));
  const expectations = capabilityExpectationsForMode(mode);
  for (const [id, expectedStatus] of Object.entries(expectations)) {
    assert(byId[id], `runtime/capabilities missing ${id}`);
    assert(byId[id].status === expectedStatus, `${id} status mismatch: expected ${expectedStatus}, saw ${byId[id].status}`);
  }
  return expectations;
};

export const assertRuntimeStartedCapabilityInventory = async ({ rpc }) => {
  const events = await rpc("events/list", { types: ["runtime.started"], limit: 5 });
  const items = itemsFrom(events, "runtime.started events/list returned no items");
  const latest = items.at(-1);
  assert(latest, "runtime.started event missing");
  const capabilities = latest.payload?.capabilities;
  assert(latest.payload?.hostBase?.id === "runtime-host-base", "runtime.started missing shared host base marker");
  assert(latest.payload?.hostBase?.version === 1, "runtime.started host base version mismatch");
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
  assert(controlPlane.runtime.hostPath === "/host" && controlPlane.runtime.capabilitiesPath === "/capabilities" && controlPlane.runtime.snapshotPath === "/snapshot", "runtime.started runtime discovery paths mismatch");
  assert(controlPlane.runtime.selfTestPath === "/self-test", "runtime.started runtime self-test path mismatch");
  assert(controlPlane.runtime.eventStreamPath === "/events/stream", "runtime.started runtime event stream path mismatch");
  assert(controlPlane.runtime.healthPath === "/healthz", "runtime.started runtime health path mismatch");
  assert(controlPlane?.build?.transport === "http", "runtime.started missing build HTTP transport");
  assert(controlPlane.build.rpcPath === "/rpc", "runtime.started build rpcPath mismatch");
  assert(controlPlane.build.statePath === "/state", "runtime.started build statePath mismatch");
  assert(controlPlane.build.methodsPath === "/methods" && controlPlane.build.hostPath === "/host" && controlPlane.build.capabilitiesPath === "/capabilities", "runtime.started build discovery paths mismatch");
  assert(controlPlane.build.eventStreamPath === "/events/stream", "runtime.started build event stream path mismatch");
  assert(controlPlane.build.statusPath === "/status", "runtime.started build status path mismatch");
  assert(controlPlane.build.snapshotPath === "/snapshot", "runtime.started build snapshot path mismatch");
  assert(controlPlane.build.selfTestPath === "/self-test", "runtime.started build self-test path mismatch");
  assertControlPlaneEndpointUrls({ assert, controlPlane, source: "runtime.started" });
  return {
    eventId: latest.id,
    mode: latest.payload?.mode,
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
  for (const id of ["runtime-state", "runtime-control", "extension-runtime", "panel-mailbox", "runtime-host", "runtime-modules"]) {
    assert(ids.includes(id), `runtime.started module inventory missing ${id}`);
  }
  assert(ids.includes("agent-backend"), "runtime.started module inventory missing agent-backend");
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
