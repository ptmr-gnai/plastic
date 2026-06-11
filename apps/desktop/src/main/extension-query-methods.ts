import { Effect } from "effect";
import {
  createEvent,
  projectExtensions,
  type EventStore,
  type PlasticEventMeta,
  type PlasticLink,
  type MethodRegistry
} from "@plastic/core";
import { scanWorkspaceExtensions } from "./extension-discovery.js";
import { noInputSchema, readOnlyEffects, readOnlyReversibility } from "./runtime-method-metadata.js";
import type { RunPromise } from "./runtime-method-context.js";

const extensionRuntimeAvailability = {
  status: "available" as const,
  notes: "Extension discovery is a shared runtime primitive available in headed and headless modes."
};

type ExtensionScanInput = {
  meta?: PlasticEventMeta;
};

const eventMetaSchema = {
  type: "object",
  description: "Optional event metadata, such as tags for validation or agent-scoped actions.",
  properties: {
    tags: { type: "array", items: { type: "string" } }
  }
};

const scanInputSchema = {
  type: "object",
  properties: {
    meta: eventMetaSchema
  }
};

const withLinks = (meta: PlasticEventMeta | undefined, links: PlasticLink[]): PlasticEventMeta => ({
  ...(meta ?? {}),
  links: [...(meta?.links ?? []), ...links]
});

export const registerExtensionQueryMethods = async (input: {
  workspaceDir: string;
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
}) => {
  await registerExtensionScan(input);
  await registerExtensionList(input);
  await registerExtensionGet(input);
};

const registerExtensionScan = async (input: {
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
      inputSchema: scanInputSchema,
      examples: [
        {
          title: "Scan workspace extensions",
          input: {},
          expectedEvents: ["extension.discovered", "extension.removed"],
          verifyWith: { method: "extensions/list", input: {} }
        }
      ],
      effects: {
        durableEvents: ["extension.discovered", "extension.removed"],
        mutatesProjection: ["extensions"]
      },
      reversibility: {
        reversible: false,
        notes: "The extension read model is append-only; compensate with a later scan or extension event."
      },
      handler: (methodInput) =>
        Effect.promise(async () => {
          const scanInput = methodInput as ExtensionScanInput;
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
                    meta: withLinks(scanInput.meta, [
                      { rel: "self", href: "extensions/get", method: "extensions/get", target: extension.id },
                      { rel: "extensions", href: "extensions/list", method: "extensions/list" }
                    ])
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
                    scope: { extensionId },
                    ...(scanInput.meta ? { meta: scanInput.meta } : {})
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
};

const registerExtensionList = async (input: {
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
}) => {
  const { eventStore, methods, runPromise } = input;

  await runPromise(
    methods.register({
      id: "extensions/list",
      title: "List extensions",
      description: "Returns the extension read model rebuilt from durable extension events.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: extensionRuntimeAvailability,
      inputSchema: noInputSchema,
      examples: [
        {
          title: "List known extensions",
          input: {},
          verifyWith: { method: "extensions/scan", input: {} }
        }
      ],
      effects: readOnlyEffects,
      reversibility: readOnlyReversibility,
      handler: () => Effect.map(eventStore.list(), projectExtensions)
    })
  );
};

const registerExtensionGet = async (input: {
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
}) => {
  const { eventStore, methods, runPromise } = input;

  await runPromise(
    methods.register({
      id: "extensions/get",
      title: "Get extension",
      description: "Returns one extension from the event-projected extension read model.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: extensionRuntimeAvailability,
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "Extension id to read." }
        }
      },
      examples: [
        {
          title: "Read a bundled extension",
          input: { id: "plastic.chat" },
          verifyWith: { method: "extensions/list", input: {} }
        }
      ],
      effects: readOnlyEffects,
      reversibility: readOnlyReversibility,
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
