import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
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
import { activateExtensions } from "./extension-host.js";
import { appendVerificationEvent, latestVerificationStatus, verifyExtension } from "./extension-verifier.js";

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

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const forkExtensionManifest = (manifest: unknown, input: {
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

const rewriteForkedRendererSource = (source: string, input: {
  sourceExtensionId: string;
  targetExtensionId: string;
}) =>
  source
    .replaceAll("../../../src/renderer/panel-renderer-api.js", "../../../apps/desktop/src/renderer/panel-renderer-api.js")
    .replaceAll(input.sourceExtensionId, input.targetExtensionId);

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
  const entryName = entryNames.find((name) => files.includes(name));
  const entry = entryName ? join(path, entryName) : undefined;

  return extensionFromManifest({
    path: relativePath(workspaceDir, path),
    ...(entry ? { entry: relativePath(workspaceDir, entry) } : {}),
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
      id: "extensions/verify",
      title: "Verify extension",
      description: "Checks whether an extension's declared files, panels, renderers, and optional target panel are usable, then writes a durable verification event.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (inputValue) =>
        Effect.promise(async () => {
          const payload = inputValue as { extensionId?: string; panelId?: string };
          if (!payload.extensionId) {
            throw new Error("extensions/verify requires extensionId");
          }

          const extension = projectExtensions(await runPromise(eventStore.list())).find(
            (candidate) => candidate.id === payload.extensionId
          );
          if (!extension) {
            throw new Error(`Extension not found: ${payload.extensionId}`);
          }

          const report = await verifyExtension(workspaceDir, extension, payload.panelId);
          const event = await appendVerificationEvent({
            eventStore,
            runPromise,
            extension,
            report,
            ...(payload.panelId ? { panelId: payload.panelId } : {})
          });

          return {
            ...report,
            event
          };
        })
    })
  );

  await runPromise(
    methods.register({
      id: "extensions/verifyAll",
      title: "Verify all extensions",
      description: "Checks every discovered extension and writes a durable verification event for each one.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: () =>
        Effect.promise(async () => {
          const extensions = projectExtensions(await runPromise(eventStore.list()));
          const reports = [];

          for (const extension of extensions) {
            const report = await verifyExtension(workspaceDir, extension);
            const event = await appendVerificationEvent({ eventStore, runPromise, extension, report });
            reports.push({ ...report, event });
          }

          return {
            ok: reports.every((report) => report.ok),
            count: reports.length,
            failed: reports.filter((report) => !report.ok).map((report) => report.extensionId),
            reports
          };
        })
    })
  );

  await runPromise(
    methods.register({
      id: "extensions/verificationStatus",
      title: "Extension verification status",
      description: "Returns the latest durable verification result for each extension.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: () =>
        Effect.map(eventStore.list(), (events) => ({
          items: latestVerificationStatus(events),
          links: [
            { rel: "verify", href: "extensions/verify", method: "extensions/verify" },
            { rel: "verify-all", href: "extensions/verifyAll", method: "extensions/verifyAll" },
            { rel: "extensions", href: "extensions/list", method: "extensions/list" }
          ]
        }))
    })
  );

  await runPromise(
    methods.register({
      id: "extensions/activate",
      title: "Activate extensions",
      description: "Loads or reloads extension main modules and lets them register runtime methods.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (inputValue) =>
        Effect.promise(async () => {
          const payload = inputValue as { extensionId?: string };
          if (payload.extensionId) {
            const extension = projectExtensions(await runPromise(eventStore.list())).find(
              (candidate) => candidate.id === payload.extensionId
            );
            if (!extension) {
              throw new Error(`Extension not found: ${payload.extensionId}`);
            }
          }

          return activateExtensions({
            workspaceDir,
            eventStore,
            methods,
            runPromise,
            ...(payload.extensionId ? { extensionId: payload.extensionId } : {})
          });
        })
    })
  );

  await runPromise(
    methods.register({
      id: "extensions/forkBundled",
      title: "Fork bundled extension",
      description: "Copies a bundled extension into .plastic/extensions with workspace ids so it can be edited and loaded as a user extension.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (inputValue) =>
        Effect.promise(async () => {
          const payload = inputValue as {
            extensionId?: string;
            targetId?: string;
            targetSlug?: string;
            overwrite?: boolean;
          };
          if (!payload.extensionId) {
            throw new Error("extensions/forkBundled requires extensionId");
          }

          const events = await runPromise(eventStore.list());
          const sourceExtension = projectExtensions(events).find(
            (candidate) => candidate.id === payload.extensionId && candidate.source === "bundled"
          );
          if (!sourceExtension?.path || !sourceExtension.manifestPath) {
            throw new Error(`Bundled extension not found: ${payload.extensionId}`);
          }

          const sourcePath = join(workspaceDir, sourceExtension.path);
          const sourceManifestPath = join(workspaceDir, sourceExtension.manifestPath);
          const sourceManifest = (await readJson(sourceManifestPath)).value;
          const targetSlug = normalizeId(
            payload.targetSlug
              ?? payload.targetId?.replace(/^workspace\./, "")
              ?? `${sourceExtension.id.replace(/^plastic\./, "")}-fork`
          );
          const targetExtensionId = payload.targetId ?? `workspace.${targetSlug}`;
          if (!targetExtensionId.startsWith("workspace.")) {
            throw new Error("extensions/forkBundled targetId must start with workspace.");
          }

          const extensionsDir = join(workspaceDir, ".plastic", "extensions");
          const targetPath = join(extensionsDir, targetSlug);
          if (await pathExists(targetPath) && !payload.overwrite) {
            throw new Error(`Fork target already exists: .plastic/extensions/${targetSlug}`);
          }

          await mkdir(extensionsDir, { recursive: true });
          await cp(sourcePath, targetPath, {
            recursive: true,
            force: Boolean(payload.overwrite),
            errorOnExist: !payload.overwrite
          });

          const forkedManifest = forkExtensionManifest(sourceManifest, {
            sourceExtensionId: sourceExtension.id,
            targetExtensionId,
            targetSlug
          });
          const targetManifestPath = join(targetPath, "plastic.extension.json");
          await writeFile(targetManifestPath, `${JSON.stringify(forkedManifest, null, 2)}\n`, "utf8");

          const targetRendererPath = join(targetPath, "renderer.ts");
          if (await pathExists(targetRendererPath)) {
            const rendererSource = await readFile(targetRendererPath, "utf8");
            await writeFile(
              targetRendererPath,
              rewriteForkedRendererSource(rendererSource, {
                sourceExtensionId: sourceExtension.id,
                targetExtensionId
              }),
              "utf8"
            );
          }

          const discovered = await discoverFolderExtension(workspaceDir, targetPath);
          const discoveredEvent = await runPromise(
            eventStore.append(
              createEvent({
                type: "extension.discovered",
                payload: {
                  id: discovered.id,
                  title: discovered.title,
                  source: discovered.source,
                  path: discovered.path,
                  entry: discovered.entry,
                  manifestPath: discovered.manifestPath,
                  manifest: {
                    id: discovered.id,
                    title: discovered.title,
                    panels: discovered.panels,
                    renderers: discovered.renderers,
                    methods: discovered.methods
                  },
                  errors: discovered.errors
                },
                scope: { extensionId: discovered.id },
                meta: {
                  links: [
                    { rel: "self", href: "extensions/get", method: "extensions/get", target: discovered.id },
                    { rel: "source", href: sourceExtension.path, target: sourceExtension.id }
                  ]
                }
              })
            )
          );
          const forkedEvent = await runPromise(
            eventStore.append(
              createEvent({
                type: "extension.forked",
                payload: {
                  sourceExtensionId: sourceExtension.id,
                  targetExtensionId: discovered.id,
                  sourcePath: sourceExtension.path,
                  targetPath: discovered.path,
                  manifestPath: discovered.manifestPath
                },
                scope: { extensionId: discovered.id },
                meta: {
                  links: [
                    { rel: "source", href: "extensions/get", method: "extensions/get", target: sourceExtension.id },
                    { rel: "target", href: "extensions/get", method: "extensions/get", target: discovered.id }
                  ]
                }
              })
            )
          );

          return {
            source: sourceExtension,
            fork: discovered,
            targetPath: discovered.path,
            events: [discoveredEvent, forkedEvent]
          };
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
