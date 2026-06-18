const fallbackSnapshotLinks = [
  { rel: "host", href: "runtime/host", method: "runtime/host" },
  { rel: "capabilities", href: "runtime/capabilities", method: "runtime/capabilities" },
  { rel: "control-plane", href: "events/list", method: "events/list", input: { types: ["runtime.started"], limit: 1 } },
  { rel: "self-test", href: "plastic/selfTest", method: "plastic/selfTest" }
];

export const expectedSnapshotLinks = await import("../apps/desktop/dist-electron/main/runtime-health-affordance-checks.js")
  .then((module) => module.expectedSnapshotLinks ?? fallbackSnapshotLinks)
  .catch(() => fallbackSnapshotLinks);

export const hasServiceAffordance = (resource, expected) =>
  resource.links?.some((link) =>
    link.rel === expected.rel && link.href === expected.href && link.method === expected.method
  )
  && resource.actions?.some((action) =>
    action.id === expected.actionId && action.method === expected.method
  );

export const hasLinkAffordance = (links, expected) =>
  links?.some((link) =>
    link.rel === expected.rel
    && link.href === expected.href
    && link.method === expected.method
    && (expected.input === undefined || JSON.stringify(link.input) === JSON.stringify(expected.input))
  );

export const hasActionAffordance = (actions, expected) =>
  actions?.some((action) =>
    action.id === expected.id
    && action.method === expected.method
    && (expected.input === undefined || JSON.stringify(action.input) === JSON.stringify(expected.input))
  );

export const assertPanelResourceAffordances = ({ assert, resources, source }) => {
  const panel = (Array.isArray(resources) ? resources : []).find((resource) => resource.kind === "panel");
  assert(panel, `${source} does not expose individual panel resources`);
  const panelId = panel.state?.id;
  assert(typeof panelId === "string", `${source} panel resource missing state.id`);
  assert(hasLinkAffordance(panel.links, { rel: "self", href: "panels/get", method: "panels/get", input: { id: panelId } }), `${source} panel resource missing self link with panel input`);
  assert(hasActionAffordance(panel.actions, { id: "rename-panel", method: "panels/rename", input: { id: panelId } }), `${source} panel resource missing rename action with panel input`);
  assert(hasActionAffordance(panel.actions, { id: "remove-panel", method: "panels/remove", input: { id: panelId } }), `${source} panel resource missing remove action with panel input`);
};

export const assertExtensionResourceAffordances = ({ assert, resources, source }) => {
  const extension = (Array.isArray(resources) ? resources : []).find((resource) => resource.kind === "extension");
  assert(extension, `${source} does not expose individual extension resources`);
  const extensionId = extension.state?.id;
  assert(typeof extensionId === "string", `${source} extension resource missing state.id`);
  assert(hasLinkAffordance(extension.links, { rel: "self", href: "extensions/get", method: "extensions/get", input: { id: extensionId } }), `${source} extension resource missing self link with extension input`);
  assert(hasActionAffordance(extension.actions, { id: "get-extension", method: "extensions/get", input: { id: extensionId } }), `${source} extension resource missing get action with extension input`);
  assert(hasActionAffordance(extension.actions, { id: "activate-extension", method: "extensions/activate", input: { extensionId } }), `${source} extension resource missing activate action with extension input`);
  assert(hasActionAffordance(extension.actions, { id: "verify-extension", method: "extensions/verify", input: { extensionId } }), `${source} extension resource missing verify action with extension input`);
};

export const assertWindowResourceAffordances = ({ assert, resources, source }) => {
  const window = (Array.isArray(resources) ? resources : []).find((resource) => resource.kind === "window");
  assert(window, `${source} does not expose individual window resources`);
  const panelId = window.state?.panelIds?.[0];
  if (typeof panelId !== "string") {
    return;
  }
  assert(hasActionAffordance(window.actions, { id: `focus-panel:${panelId}`, method: "windows/focusPanel", input: { panelId } }), `${source} window resource missing focus action with panel input`);
  assert(hasActionAffordance(window.actions, { id: `scroll-panel:${panelId}`, method: "windows/scrollToRef", input: { ref: `panel:${panelId}` } }), `${source} window resource missing scroll action with ref input`);
};

export const assertResourceMethodReferences = ({ assert, resources, methodIds, source }) => {
  const transportMethods = new Set(["http/post"]);
  const unknown = [];
  for (const resource of Array.isArray(resources) ? resources : []) {
    for (const affordance of [...(resource.links ?? []), ...(resource.actions ?? [])]) {
      if (typeof affordance.method === "string" && !transportMethods.has(affordance.method) && !methodIds.has(affordance.method)) {
        unknown.push(`${resource.id}:${affordance.method}`);
      }
    }
  }
  assert(unknown.length === 0, `${source} resource affordances reference unknown methods: ${unknown.join(", ")}`);
};

export const assertContextualResourceAffordances = (input) => {
  assertPanelResourceAffordances(input);
  assertExtensionResourceAffordances(input);
  assertWindowResourceAffordances(input);
};
