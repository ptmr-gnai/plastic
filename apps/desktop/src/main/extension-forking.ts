import { normalizeId } from "./extension-discovery.js";

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export const forkExtensionManifest = (manifest: unknown, input: {
  sourceExtensionId: string;
  targetExtensionId: string;
  targetSlug: string;
}) => {
  const source = asRecord(manifest);
  const rendererIdMap = new Map<string, string>();
  const targetTitle = `${asString(source.title) ?? input.targetSlug} Fork`;

  const renderers = Array.isArray(source.renderers)
    ? source.renderers.map((rendererValue) => {
      const renderer = asRecord(rendererValue);
      const oldId = asString(renderer.id) ?? `${input.sourceExtensionId}.renderer`;
      const suffix = oldId.startsWith(`${input.sourceExtensionId}.`)
        ? oldId.slice(input.sourceExtensionId.length + 1)
        : normalizeId(oldId);
      const newId = `${input.targetExtensionId}.${suffix}`;
      rendererIdMap.set(oldId, newId);
      return {
        ...renderer,
        id: newId
      };
    })
    : [];

  const panels = Array.isArray(source.panels)
    ? source.panels.map((panelValue, index) => {
      const panel = asRecord(panelValue);
      const oldPanelId = asString(panel.id) ?? `${input.sourceExtensionId}.panel-${index}`;
      const suffix = oldPanelId.includes("-")
        ? oldPanelId.split("-").slice(1).join("-")
        : `panel-${index + 1}`;
      const oldRendererId = asString(panel.rendererId);
      return {
        ...panel,
        id: `${input.targetSlug}-${suffix || index + 1}`,
        title: `${asString(panel.title) ?? `Panel ${index + 1}`} Fork`,
        rendererId: oldRendererId ? rendererIdMap.get(oldRendererId) ?? oldRendererId : undefined
      };
    })
    : [];

  return {
    ...source,
    id: input.targetExtensionId,
    title: targetTitle,
    forkOf: {
      extensionId: input.sourceExtensionId
    },
    renderers,
    panels
  };
};

export const rewriteForkedRendererSource = (source: string, input: {
  sourceExtensionId: string;
  targetExtensionId: string;
}) =>
  source
    .replaceAll("../../../src/renderer/panel-renderer-api.js", "../../../apps/desktop/src/renderer/panel-renderer-api.js")
    .replaceAll(input.sourceExtensionId, input.targetExtensionId);
