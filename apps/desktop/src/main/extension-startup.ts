import {
  createEvent,
  projectExtensions,
  projectPanels,
  type EventStore,
  type PlasticEvent,
  type PlasticExtension
} from "@plastic/core";
import {
  scanBundledExtensions,
  scanWorkspaceExtensions
} from "./extension-loader.js";
import type { RunPromise } from "./runtime-method-context.js";

type ExtensionStartupInput = {
  workspaceDir: string;
  bundledExtensionsDir: string;
  eventStore: EventStore;
  runPromise: RunPromise;
};

export const discoverBundledExtensionsAtStartup = async (input: ExtensionStartupInput) => {
  const events = await input.runPromise(input.eventStore.list());
  const extensions = await scanBundledExtensions(input.workspaceDir, input.bundledExtensionsDir);
  for (const extension of extensions) {
    if (latestManifestMatches(events, extension)) {
      continue;
    }
    await appendDiscoveredExtension(input, extension, extension);
  }
  return extensions;
};

export const discoverWorkspaceExtensionsAtStartup = async (
  input: Omit<ExtensionStartupInput, "bundledExtensionsDir">
) => {
  const extensions = await scanWorkspaceExtensions(input.workspaceDir);
  for (const extension of extensions) {
    await appendDiscoveredExtension(input, extension, {
      id: extension.id,
      title: extension.title,
      panels: extension.panels,
      renderers: extension.renderers,
      methods: extension.methods
    });
  }
  return extensions;
};

export const ensureBundledPanelsAtStartup = async (input: Omit<ExtensionStartupInput, "bundledExtensionsDir">) => {
  const events = await input.runPromise(input.eventStore.list());
  const extensions = projectExtensions(events);
  const existingPanelIds = new Set(projectPanels(events).map((panel) => panel.id));
  const introducedPanelIds = new Set(
    events
      .filter((event) => event.type === "panel.created")
      .map((event) => {
        const payload = event.payload as { id?: string };
        return payload.id ?? event.scope.panelId;
      })
      .filter((id): id is string => Boolean(id))
  );
  let created = 0;

  for (const extension of extensions.filter((candidate) => candidate.source === "bundled")) {
    for (const panel of extension.panels) {
      if (existingPanelIds.has(panel.id) || introducedPanelIds.has(panel.id)) {
        continue;
      }

      await input.runPromise(
        input.eventStore.append(
          createEvent({
            type: "panel.created",
            payload: {
              ...panel,
              extensionId: extension.id
            },
            scope: {
              panelId: panel.id,
              extensionId: extension.id
            },
            meta: {
              links: [
                { rel: "panel", href: "panels/get", method: "panels/get", target: panel.id },
                { rel: "extension", href: "extensions/get", method: "extensions/get", target: extension.id }
              ]
            }
          })
        )
      );
      created += 1;
      existingPanelIds.add(panel.id);
      introducedPanelIds.add(panel.id);
    }
  }

  return { created };
};

export const ensurePanelRendererBindingsAtStartup = async (input: Omit<ExtensionStartupInput, "bundledExtensionsDir">) => {
  const events = await input.runPromise(input.eventStore.list());
  const extensions = projectExtensions(events);
  const panels = projectPanels(events);
  let bound = 0;

  for (const panel of panels) {
    if (panel.rendererId) {
      continue;
    }

    const extension = extensions.find((candidate) => candidate.id === panel.extensionId);
    const renderer = extension?.renderers.find((candidate) => candidate.panelKinds.includes(panel.kind))
      ?? extension?.renderers[0];
    if (!renderer) {
      continue;
    }

    await input.runPromise(
      input.eventStore.append(
        createEvent({
          type: "panel.renderer.bound",
          payload: {
            id: panel.id,
            extensionId: panel.extensionId,
            rendererId: renderer.id,
            reason: "matched extension renderer contribution"
          },
          scope: {
            panelId: panel.id,
            extensionId: panel.extensionId
          },
          meta: {
            links: [
              { rel: "panel", href: "panels/get", method: "panels/get", target: panel.id },
              { rel: "extension", href: "extensions/get", method: "extensions/get", target: panel.extensionId }
            ]
          }
        })
      )
    );
    bound += 1;
  }

  return { bound };
};

const latestManifestMatches = (events: PlasticEvent[], extension: PlasticExtension) => {
  const latestManifest = events
    .filter((event) => event.type === "extension.discovered" && event.scope.extensionId === extension.id)
    .map((event) => (event.payload as { manifest?: unknown }).manifest)
    .at(-1);
  return JSON.stringify(latestManifest) === JSON.stringify(extension);
};

const appendDiscoveredExtension = async (
  input: Omit<ExtensionStartupInput, "bundledExtensionsDir">,
  extension: PlasticExtension,
  manifest: unknown
) =>
  input.runPromise(
    input.eventStore.append(
      createEvent({
        type: "extension.discovered",
        payload: {
          id: extension.id,
          title: extension.title,
          source: extension.source,
          path: extension.path,
          entry: extension.entry,
          manifestPath: extension.manifestPath,
          manifest,
          errors: extension.errors
        },
        scope: { extensionId: extension.id },
        meta: {
          links: [
            { rel: "self", href: "extensions/get", method: "extensions/get", target: extension.id },
            { rel: "extensions", href: "extensions/list", method: "extensions/list" }
          ]
        }
      })
    )
  );
