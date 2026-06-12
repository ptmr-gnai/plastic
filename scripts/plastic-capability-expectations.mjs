const fallbackMethodCapabilities = {
  "renderer/reload": { required: ["electron.window"], degradedWhenMissing: [] },
  "windows/create": { required: ["electron.window"], degradedWhenMissing: [] },
  "windows/focusPanel": { required: ["electron.window", "dom.refs"], degradedWhenMissing: [] },
  "windows/scrollToRef": { required: ["electron.window", "dom.refs"], degradedWhenMissing: [] },
  "windows/screenshot": { required: ["electron.window", "screenshot"], degradedWhenMissing: [] },
  "deixis/listVisibleRefs": { required: ["dom.refs"], degradedWhenMissing: [] },
  "deixis/resolveRef": { required: ["dom.refs"], degradedWhenMissing: [] },
  "deixis/evalDom": { required: ["dom.eval"], degradedWhenMissing: [] },
  "deixis/verifyRefAction": { required: ["dom.refs", "event.projection"], degradedWhenMissing: [] },
  "deixis/clickRef": { required: ["dom.refs", "dom.input"], degradedWhenMissing: [] },
  "deixis/fillRef": { required: ["dom.refs", "dom.input"], degradedWhenMissing: [] },
  "windows/list": { required: ["electron.window", "window.projection"], degradedWhenMissing: ["electron.window"] }
};

let runtimeMethodCapabilitiesPromise;
let runtimeAgentBackendMethodIdsPromise;

const normalizeCapabilityTable = (table) =>
  Object.fromEntries(Object.entries(table).map(([id, contract]) => [
    id,
    {
      required: contract.required ?? [],
      degradedWhenMissing: contract.degradedWhenMissing ?? []
    }
  ]));

const loadRuntimeMethodCapabilities = async () => {
  if (!runtimeMethodCapabilitiesPromise) {
    runtimeMethodCapabilitiesPromise = Promise.all([
      import("../apps/desktop/dist-electron/main/window-availability.js"),
      import("../apps/desktop/dist-electron/main/deixis-availability.js")
    ])
      .then(([windowAvailability, deixisAvailability]) => ({
        ...normalizeCapabilityTable(windowAvailability.windowMethodCapabilities),
        ...normalizeCapabilityTable(deixisAvailability.deixisMethodCapabilities)
      }))
      .catch(() => fallbackMethodCapabilities);
  }
  return runtimeMethodCapabilitiesPromise;
};

const fallbackAgentBackendMethodIds = [
  "codex/status",
  "chats/getBinding",
  "chats/createCodexChat",
  "chats/sendToCodex",
  "codex/defaults",
  "codex/setDefaults",
  "codex/connect",
  "codex/initialize",
  "codex/request",
  "codex/threadStart",
  "codex/threadResume",
  "codex/threadFork",
  "codex/threadList",
  "codex/threadRead",
  "codex/threadArchive",
  "codex/threadNameSet",
  "codex/turnStart",
  "codex/turnSteer",
  "codex/turnInterrupt",
  "codex/modelList",
  "codex/configRead",
  "bridge/configurePlasticMcp",
  "bridge/status",
  "bridge/test",
  "bridge/callPlasticRpcTool",
  "chats/bindCodexThread",
  "chats/startCodexThread",
  "chats/interrupt",
  "chats/close"
];

const loadRuntimeAgentBackendMethodIds = async () => {
  if (!runtimeAgentBackendMethodIdsPromise) {
    runtimeAgentBackendMethodIdsPromise = import("../apps/desktop/dist-electron/main/agent-backend-fallback-methods.js")
      .then((module) => module.agentBackendFallbackMethodIds ?? fallbackAgentBackendMethodIds)
      .catch(() => fallbackAgentBackendMethodIds);
  }
  return runtimeAgentBackendMethodIdsPromise;
};

export const capabilityExpectationsForMode = (mode) => {
  const visualStatus = mode === "electron" ? "available" : "unavailable";
  const backendStatus = mode === "electron" ? "available" : "unavailable";
  return {
    "runtime.capabilities": "available",
    "window.projection": "available",
    "event.projection": "available",
    "electron.window": visualStatus,
    "dom.refs": visualStatus,
    "dom.eval": visualStatus,
    "dom.input": visualStatus,
    screenshot: visualStatus,
    "agent.codex": backendStatus
  };
};

const expectationsFromRequirements = (mode, requirements) => {
  const capabilities = capabilityExpectationsForMode(mode);
  return Object.fromEntries(Object.entries(requirements).map(([methodId, requiredCapabilities]) => {
    const missingCapabilities = requiredCapabilities.filter((id) => capabilities[id] !== "available");
    return [
      methodId,
      {
        status: missingCapabilities.length === 0 ? "available" : "unavailable",
        requiredCapabilities,
        missingCapabilities
      }
    ];
  }));
};

const expectationFromMethodCapability = (mode, methodId, contract) => {
  const capabilities = capabilityExpectationsForMode(mode);
  const missingCapabilities = contract.required.filter((id) => capabilities[id] !== "available");
  const degradedMissingCapabilities = contract.degradedWhenMissing.filter((id) => capabilities[id] !== "available");
  return [
    methodId,
    {
      status: degradedMissingCapabilities.length > 0 ? "degraded" : missingCapabilities.length === 0 ? "available" : "unavailable",
      requiredCapabilities: contract.required,
      missingCapabilities: degradedMissingCapabilities.length > 0 ? degradedMissingCapabilities : missingCapabilities
    }
  ];
};

export const capabilityBackedMethodExpectationsForMode = async (mode) =>
  Object.fromEntries(
    Object.entries(await loadRuntimeMethodCapabilities()).map(([methodId, contract]) =>
      expectationFromMethodCapability(mode, methodId, contract)
    )
  );

export const agentBackendMethodExpectationsForMode = async (mode) =>
  expectationsFromRequirements(
    mode,
    Object.fromEntries((await loadRuntimeAgentBackendMethodIds()).map((id) => [id, ["agent.codex"]]))
  );
