import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { Effect } from "effect";
import {
  createEvent,
  extensionFromManifest,
  projectExtensions,
  type EventStore,
  type MethodRegistry,
  type PlasticExtension
} from "@plastic/core";

type RunPromise = <A>(effect: Effect.Effect<A, unknown>) => Promise<A>;

const extensionFileExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const manifestNames = ["plastic.extension.json"];
const entryNames = ["index.tsx", "index.ts", "main.ts", "main.tsx", "index.js", "main.js"];

const normalizeId = (value: string): string =>
  value
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const relativePath = (workspaceDir: string, path: string): string => relative(workspaceDir, path) || ".";

const readJson = async (path: string): Promise<{ value: unknown; error?: string }> => {
  try {
    return { value: JSON.parse(await readFile(path, "utf8")) };
  } catch (error) {
    return {
      value: {},
      error: error instanceof Error ? error.message : String(error)
    };
  }
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const discoverFileExtension = async (workspaceDir: string, path: string): Promise<PlasticExtension> => {
  const id = `workspace.${normalizeId(basename(path))}`;
  return extensionFromManifest({
    path: relativePath(workspaceDir, path),
    entry: relativePath(workspaceDir, path),
    manifest: {
      id,
      title: basename(path, extname(path)),
      panels: [
        {
          id: `${id}.panel`,
          title: basename(path, extname(path)),
          kind: "extension"
        }
      ]
    },
    fallbackId: id,
    source: "workspace"
  });
};

const discoverFolderExtension = async (workspaceDir: string, path: string): Promise<PlasticExtension> => {
  const errors: string[] = [];
  const files = await readdir(path);
  const manifestName = manifestNames.find((name) => files.includes(name));
  const manifestPath = manifestName ? join(path, manifestName) : undefined;
  const manifestResult = manifestPath ? await readJson(manifestPath) : { value: {} };
  if (manifestResult.error) {
    errors.push(manifestResult.error);
  }

  const entryName = entryNames.find((name) => files.includes(name));
  const entry = entryName ? join(path, entryName) : undefined;
  const id = `workspace.${normalizeId(basename(path))}`;

  if (!entry && !manifestPath) {
    errors.push("Folder extension has no manifest or supported entry file.");
  }

  const input: Parameters<typeof extensionFromManifest>[0] = {
    path: relativePath(workspaceDir, path),
    manifest: manifestResult.value,
    fallbackId: id,
    fallbackTitle: basename(path),
    source: "workspace",
    errors
  };
  if (entry) {
    input.entry = relativePath(workspaceDir, entry);
  }
  if (manifestPath) {
    input.manifestPath = relativePath(workspaceDir, manifestPath);
  }
  return extensionFromManifest(input);
};

const discoverBundledFolderExtension = async (workspaceDir: string, path: string): Promise<PlasticExtension> => {
  const files = await readdir(path);
  const manifestName = manifestNames.find((name) => files.includes(name));
  const manifestPath = manifestName ? join(path, manifestName) : undefined;
  const errors: string[] = [];

  if (!manifestPath) {
    errors.push("Bundled extension has no plastic.extension.json manifest.");
  }

  const manifestResult = manifestPath ? await readJson(manifestPath) : { value: {} };
  if (manifestResult.error) {
    errors.push(manifestResult.error);
  }

  return extensionFromManifest({
    path: relativePath(workspaceDir, path),
    manifest: manifestResult.value,
    fallbackId: `plastic.${normalizeId(basename(path))}`,
    fallbackTitle: basename(path),
    source: "bundled",
    errors,
    ...(manifestPath ? { manifestPath: relativePath(workspaceDir, manifestPath) } : {})
  });
};

export const scanBundledExtensions = async (workspaceDir: string, bundledExtensionsDir: string): Promise<PlasticExtension[]> => {
  if (!await pathExists(bundledExtensionsDir)) {
    return [];
  }

  const entries = await readdir(bundledExtensionsDir);
  const extensions: PlasticExtension[] = [];

  for (const entry of entries.sort()) {
    if (entry.startsWith(".")) {
      continue;
    }

    const path = join(bundledExtensionsDir, entry);
    const stats = await stat(path);
    if (stats.isDirectory()) {
      extensions.push(await discoverBundledFolderExtension(workspaceDir, path));
    }
  }

  return extensions;
};

export const scanWorkspaceExtensions = async (workspaceDir: string): Promise<PlasticExtension[]> => {
  const extensionsDir = join(workspaceDir, ".plastic", "extensions");
  if (!await pathExists(extensionsDir)) {
    return [];
  }

  const entries = await readdir(extensionsDir);
  const extensions: PlasticExtension[] = [];

  for (const entry of entries.sort()) {
    if (entry.startsWith(".")) {
      continue;
    }

    const path = join(extensionsDir, entry);
    const stats = await stat(path);
    if (stats.isDirectory()) {
      extensions.push(await discoverFolderExtension(workspaceDir, path));
      continue;
    }

    if (stats.isFile() && extensionFileExtensions.has(extname(entry))) {
      extensions.push(await discoverFileExtension(workspaceDir, path));
    }
  }

  return extensions;
};

export const registerExtensionMethods = async (input: {
  workspaceDir: string;
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
}) => {
  const { workspaceDir, eventStore, methods, runPromise } = input;

  await runPromise(
    methods.register({
      id: "extensions/scan",
      title: "Scan workspace extensions",
      description: "Discovers extensions under .plastic/extensions and writes durable extension.discovered events.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: () =>
        Effect.promise(async () => {
          const discovered = await scanWorkspaceExtensions(workspaceDir);
          const current = projectExtensions(await runPromise(eventStore.list()));
          const currentIds = new Set(current.map((extension) => extension.id));
          const discoveredIds = new Set(discovered.map((extension) => extension.id));
          const events = [];

          for (const extension of discovered) {
            events.push(
              await runPromise(
                eventStore.append(
                  createEvent({
                    type: "extension.discovered",
                    payload: {
                      id: extension.id,
                      title: extension.title,
                      source: extension.source,
                      path: extension.path,
                      entry: extension.entry,
                      manifestPath: extension.manifestPath,
                      manifest: {
                        id: extension.id,
                        title: extension.title,
                        panels: extension.panels,
                        renderers: extension.renderers,
                        methods: extension.methods
                      },
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
              )
            );
          }

          for (const extensionId of currentIds) {
            if (!extensionId.startsWith("workspace.") || discoveredIds.has(extensionId)) {
              continue;
            }
            events.push(
              await runPromise(
                eventStore.append(
                  createEvent({
                    type: "extension.removed",
                    payload: { id: extensionId, reason: "not found during scan" },
                    scope: { extensionId }
                  })
                )
              )
            );
          }

          return {
            discovered,
            events
          };
        })
    })
  );

  await runPromise(
    methods.register({
      id: "extensions/list",
      title: "List extensions",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: () => Effect.map(eventStore.list(), projectExtensions)
    })
  );

  await runPromise(
    methods.register({
      id: "extensions/get",
      title: "Get extension",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (inputValue) =>
        Effect.map(eventStore.list(), (events) => {
          const id = (inputValue as { id?: string }).id;
          const extension = projectExtensions(events).find((candidate) => candidate.id === id);
          if (!extension) {
            throw new Error(`Extension not found: ${id}`);
          }
          return extension;
        })
    })
  );

  await runPromise(
    methods.register({
      id: "extensions/registerPanel",
      title: "Register extension panel",
      description: "Creates a panel from an extension's declared panel contribution.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (inputValue) =>
        Effect.promise(async () => {
          const input = inputValue as { extensionId?: string; panelId?: string; order?: number };
          if (!input.extensionId) {
            throw new Error("extensions/registerPanel requires extensionId");
          }
          const extension = projectExtensions(await runPromise(eventStore.list())).find(
            (candidate) => candidate.id === input.extensionId
          );
          if (!extension) {
            throw new Error(`Extension not found: ${input.extensionId}`);
          }
          const contribution = input.panelId
            ? extension.panels.find((panel) => panel.id === input.panelId)
            : extension.panels[0];
          if (!contribution) {
            throw new Error(`Extension has no panel contribution: ${input.extensionId}`);
          }

          return runPromise(
            eventStore.append(
              createEvent({
                type: "panel.created",
                payload: {
                  id: contribution.id,
                  title: contribution.title,
                  kind: contribution.kind ?? "extension",
                  extensionId: extension.id,
                  rendererId: contribution.rendererId,
                  subtitle: contribution.subtitle ?? extension.title,
                  body: contribution.body ?? `Panel contributed by ${extension.title}.`,
                  order: input.order ?? contribution.order
                },
                scope: {
                  panelId: contribution.id,
                  extensionId: extension.id
                },
                meta: {
                  links: [
                    { rel: "extension", href: "extensions/get", method: "extensions/get", target: extension.id },
                    { rel: "panel", href: "panels/get", method: "panels/get", target: contribution.id }
                  ]
                }
              })
            )
          );
        })
    })
  );
};
