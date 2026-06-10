import { Effect } from "effect";
import {
  createEvent,
  projectExtensions,
  type EventStore,
  type MethodRegistry
} from "@plastic/core";
import { scanWorkspaceExtensions } from "./extension-discovery.js";
import type { RunPromise } from "./runtime-method-context.js";

const extensionRuntimeAvailability = {
  status: "available" as const,
  notes: "Extension discovery is a shared runtime primitive available in headed and headless modes."
};

export const registerExtensionQueryMethods = async (input: {
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
      availability: extensionRuntimeAvailability,
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
      availability: extensionRuntimeAvailability,
      handler: () => Effect.map(eventStore.list(), projectExtensions)
    })
  );

  await runPromise(
    methods.register({
      id: "extensions/get",
      title: "Get extension",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: extensionRuntimeAvailability,
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
};
