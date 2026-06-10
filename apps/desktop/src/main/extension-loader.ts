import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import {
  createEvent,
  projectExtensions,
  type EventStore,
  type MethodRegistry,
} from "@plastic/core";
import {
  discoverFolderExtension,
  normalizeId,
  pathExists,
  readJson,
  scanBundledExtensions
} from "./extension-discovery.js";
import { forkExtensionManifest, rewriteForkedRendererSource } from "./extension-forking.js";
import { registerExtensionActivationMethods } from "./extension-activation-methods.js";
import { registerExtensionQueryMethods } from "./extension-query-methods.js";
import { registerExtensionVerificationMethods } from "./extension-verification-methods.js";

type RunPromise = <A>(effect: Effect.Effect<A, unknown>) => Promise<A>;

export { scanBundledExtensions, scanWorkspaceExtensions } from "./extension-discovery.js";

export const registerExtensionMethods = async (input: {
  workspaceDir: string;
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
}) => {
  const { workspaceDir, eventStore, methods, runPromise } = input;

  await registerExtensionQueryMethods(input);
  await registerExtensionVerificationMethods(input);
  await registerExtensionActivationMethods(input);

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
