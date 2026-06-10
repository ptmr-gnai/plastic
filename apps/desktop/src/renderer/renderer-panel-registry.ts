import { createExtensionRendererFromContribution } from "./extension-renderer-registry.js";
import type {
  PanelRenderer,
  PlasticPanel
} from "./panel-renderer-api.js";
import {
  escapeHtml,
  type PlasticExtension
} from "./renderer-client.js";

type RendererRegistryInput = {
  extensions: PlasticExtension[];
  renderCodexPanel: () => string;
  renderAgentDevPanel: () => string;
};

export const genericPanelRenderer = (id: string, extensionId: string, panelKinds: string[] = ["generic"]): PanelRenderer => ({
  id,
  extensionId,
  panelKinds,
  closeMethod: "panels/close",
  closeInputKey: "id",
  render: ({ panel }) => `<p>${escapeHtml(panel.body ?? "This panel is projected from the durable event stream.")}</p>`
});

export const createPanelRendererRegistry = (input: RendererRegistryInput) => {
  const panelRenderers = new Map<string, PanelRenderer>([
    [
      "plastic.codex.runtime-panel",
      {
        id: "plastic.codex.runtime-panel",
        extensionId: "plastic.codex",
        panelKinds: ["agent-runtime"],
        closeMethod: "panels/close",
        closeInputKey: "id",
        render: input.renderCodexPanel
      }
    ],
    [
      "plastic.agent-dev.panel",
      {
        id: "plastic.agent-dev.panel",
        extensionId: "plastic.agent-dev",
        panelKinds: ["agent-dev"],
        closeMethod: "panels/close",
        closeInputKey: "id",
        render: input.renderAgentDevPanel
      }
    ],
    [
      "plastic.document.markdown-panel",
      genericPanelRenderer("plastic.document.markdown-panel", "plastic.document", ["document"])
    ],
    [
      "plastic.tasks.tasks-panel",
      genericPanelRenderer("plastic.tasks.tasks-panel", "plastic.tasks", ["tasks"])
    ],
    [
      "plastic.generic.panel",
      genericPanelRenderer("plastic.generic.panel", "plastic.runtime")
    ]
  ]);

  for (const extension of input.extensions) {
    for (const contribution of extension.renderers) {
      if (panelRenderers.has(contribution.id)) {
        continue;
      }
      const renderer = createExtensionRendererFromContribution(extension.path, contribution, {
        chat: () => ({
          buttons: [],
          messages: [],
          binding: undefined,
          peer: undefined,
          escapeHtml
        })
      }) ?? genericPanelRenderer(contribution.id, extension.id, contribution.panelKinds);
      panelRenderers.set(contribution.id, renderer);
    }
  }

  return panelRenderers;
};

export const resolvePanelRenderer = (input: {
  panel: PlasticPanel;
  extensions: PlasticExtension[];
  panelRenderers: Map<string, PanelRenderer>;
}): PanelRenderer => {
  const { panel, extensions, panelRenderers } = input;
  if (panel.rendererId && panelRenderers.has(panel.rendererId)) {
    return panelRenderers.get(panel.rendererId) ?? panelRenderers.get("plastic.generic.panel")!;
  }

  const extension = extensions.find((candidate) => candidate.id === panel.extensionId);
  const rendererContribution = extension?.renderers.find((renderer) => renderer.panelKinds.includes(panel.kind))
    ?? extension?.renderers[0];
  if (rendererContribution && panelRenderers.has(rendererContribution.id)) {
    return panelRenderers.get(rendererContribution.id) ?? panelRenderers.get("plastic.generic.panel")!;
  }

  return panelRenderers.get("plastic.generic.panel")!;
};
