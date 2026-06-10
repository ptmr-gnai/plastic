import { createEvent, type EventStore, type PlasticEvent, type PlasticExtension } from "@plastic/core";
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
