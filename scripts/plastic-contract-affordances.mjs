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
