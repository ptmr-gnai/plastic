import type { PanelRenderer } from "../../../apps/desktop/src/renderer/panel-renderer-api.js";

export const renderer: PanelRenderer = {
  id: "workspace.hello-panel.renderer",
  extensionId: "workspace.hello-panel",
  panelKinds: ["extension"],
  closeMethod: "panels/close",
  closeInputKey: "id",
  render: ({ panel }) => `
    <section class="workspace-extension-surface" data-plastic-ref="workspace-extension:hello-panel">
      <p class="eyebrow">Workspace renderer module</p>
      <h3>${panel.title}</h3>
      <p>This HTML is rendered from <code>.plastic/extensions/hello-panel/renderer.ts</code>.</p>
    </section>
  `
};
