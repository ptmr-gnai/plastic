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

export const capabilityBackedMethodExpectationsForMode = (mode) => {
  const capabilities = capabilityExpectationsForMode(mode);
  const entries = Object.entries(methodCapabilityRequirements).map(([methodId, requiredCapabilities]) => {
    const missingCapabilities = requiredCapabilities.filter((id) => capabilities[id] !== "available");
    return [
      methodId,
      {
        status: missingCapabilities.length === 0 ? "available" : "unavailable",
        requiredCapabilities,
        missingCapabilities
      }
    ];
  });
  return {
    "windows/list": {
      status: mode === "electron" ? "available" : "degraded",
      requiredCapabilities: ["electron.window", "window.projection"],
      missingCapabilities: mode === "electron" ? [] : ["electron.window"]
    },
    ...Object.fromEntries(entries)
  };
};
