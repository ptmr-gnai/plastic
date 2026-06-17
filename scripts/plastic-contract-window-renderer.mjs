export const assertWindowRendererMethodDescriptions = ({ assert, descriptions }) => {
  assert(descriptions.rendererReload.outputSchema?.required?.includes("ok"), "renderer/reload output schema must require ok");
  assert(descriptions.windowsList.outputSchema?.type === "array", "windows/list output schema must be an array");
  assert(descriptions.windowsList.outputSchema?.items?.required?.includes("id"), "windows/list item schema must require id");
  assert(descriptions.windowsCreate.outputSchema?.required?.includes("electronWindowId"), "windows/create output schema must require electronWindowId");
  assert(descriptions.windowsFocusPanel.outputSchema?.items?.required?.includes("found"), "windows/focusPanel output schema must expose found");
  assert(descriptions.windowsScrollToRef.outputSchema?.items?.required?.includes("windowId"), "windows/scrollToRef output schema must expose windowId");
  assert(descriptions.windowsCreate.effects?.durableEvents?.includes("window.created"), "windows/create must describe window.created event");
  assert(descriptions.rendererReload.reversibility?.reversible === false, "renderer/reload must describe transient reversibility");
};
