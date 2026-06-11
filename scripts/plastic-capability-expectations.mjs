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

