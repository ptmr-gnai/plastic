import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import {
  createEvent,
  projectExtensions,
  type EventStore,
  type MethodRegistry,
  type PlasticExtension
} from "@plastic/core";
import {
  discoverFolderExtension,
  normalizeId,
  pathExists,
  readJson
} from "./extension-discovery.js";
import { forkExtensionManifest, rewriteForkedRendererSource } from "./extension-forking.js";
import type { RunPromise } from "./runtime-method-context.js";

type ForkBundledInput = {
  extensionId?: string;
  targetId?: string;
  targetSlug?: string;
  overwrite?: boolean;
};

type BundledForkSource = PlasticExtension & {
  path: string;
  manifestPath: string;
};

const findBundledExtension = (events: Parameters<typeof projectExtensions>[0], payload: ForkBundledInput) => {
  if (!payload.extensionId) {
    throw new Error("extensions/forkBundled requires extensionId");
  }

  const sourceExtension = projectExtensions(events).find(
    (candidate) => candidate.id === payload.extensionId && candidate.source === "bundled"
  );
  if (!sourceExtension?.path || !sourceExtension.manifestPath) {
    throw new Error(`Bundled extension not found: ${payload.extensionId}`);
  }
  return sourceExtension as BundledForkSource;
};

const resolveForkTarget = async (input: {
  workspaceDir: string;
  payload: ForkBundledInput;
  sourceExtension: BundledForkSource;
}) => {
  const { workspaceDir, payload, sourceExtension } = input;
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

  return {
    sourcePath,
    sourceManifest,
    extensionsDir,
    targetExtensionId,
    targetPath,
    targetSlug
  };
};

const writeForkedExtension = async (input: {
  overwrite: boolean | undefined;
  sourceExtension: BundledForkSource;
  sourceManifest: unknown;
  sourcePath: string;
  extensionsDir: string;
  targetExtensionId: string;
  targetPath: string;
  targetSlug: string;
}) => {
  const {
    overwrite,
    sourceExtension,
    sourceManifest,
    sourcePath,
    extensionsDir,
    targetExtensionId,
    targetPath,
    targetSlug
  } = input;

  await mkdir(extensionsDir, { recursive: true });
  await cp(sourcePath, targetPath, {
    recursive: true,
    force: Boolean(overwrite),
    errorOnExist: !overwrite
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
};

const appendForkEvents = async (input: {
  eventStore: EventStore;
  runPromise: RunPromise;
  sourceExtension: BundledForkSource;
  discovered: PlasticExtension;
}) => {
  const { eventStore, runPromise, sourceExtension, discovered } = input;
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

  return [discoveredEvent, forkedEvent];
};

export const registerExtensionForkMethods = async (input: {
  workspaceDir: string;
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
}) => {
  const { workspaceDir, eventStore, methods, runPromise } = input;

  await runPromise(
    methods.register({
      id: "extensions/forkBundled",
      title: "Fork bundled extension",
      description: "Copies a bundled extension into .plastic/extensions with workspace ids so it can be edited and loaded as a user extension.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (inputValue) =>
        Effect.promise(async () => {
          const payload = inputValue as ForkBundledInput;
          const events = await runPromise(eventStore.list());
          const sourceExtension = findBundledExtension(events, payload);
          const target = await resolveForkTarget({ workspaceDir, payload, sourceExtension });
          await writeForkedExtension({ ...target, sourceExtension, overwrite: payload.overwrite });
          const discovered = await discoverFolderExtension(workspaceDir, target.targetPath);
          const forkEvents = await appendForkEvents({ eventStore, runPromise, sourceExtension, discovered });

          return {
            source: sourceExtension,
            fork: discovered,
            targetPath: discovered.path,
            events: forkEvents
          };
        })
    })
  );
};
