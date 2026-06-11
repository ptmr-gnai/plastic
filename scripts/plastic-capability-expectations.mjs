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

const methodCapabilityRequirements = {
  "renderer/reload": ["electron.window"],
  "windows/create": ["electron.window"],
  "windows/focusPanel": ["electron.window", "dom.refs"],
  "windows/scrollToRef": ["electron.window", "dom.refs"],
  "windows/screenshot": ["electron.window", "screenshot"],
  "deixis/listVisibleRefs": ["dom.refs"],
  "deixis/resolveRef": ["dom.refs"],
  "deixis/evalDom": ["dom.eval"],
  "deixis/verifyRefAction": ["dom.refs", "event.projection"],
  "deixis/clickRef": ["dom.refs", "dom.input"],
  "deixis/fillRef": ["dom.refs", "dom.input"]
};

export const agentBackendMethodIds = [
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

export const capabilityBackedMethodExpectationsForMode = (mode) => {
  return {
    "windows/list": {
      status: mode === "electron" ? "available" : "degraded",
      requiredCapabilities: ["electron.window", "window.projection"],
      missingCapabilities: mode === "electron" ? [] : ["electron.window"]
    },
    ...expectationsFromRequirements(mode, methodCapabilityRequirements)
  };
};

export const agentBackendMethodExpectationsForMode = (mode) =>
  expectationsFromRequirements(
    mode,
    Object.fromEntries(agentBackendMethodIds.map((id) => [id, ["agent.codex"]]))
  );
