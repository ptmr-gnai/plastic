import { Effect } from "effect";
import {
  createEvent,
  projectExtensions,
  type EventStore,
  type MethodRegistry
} from "@plastic/core";
import { plasticEventSchema } from "./runtime-control-schemas.js";
import type { RunPromise } from "./runtime-method-context.js";

const extensionPanelAvailability = {
  status: "available" as const,
  notes: "Extension panel registration appends durable panel events through the shared runtime."
};

export const registerExtensionPanelMethods = async (input: {
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
}) => {
  const { eventStore, methods, runPromise } = input;

  await runPromise(
    methods.register({
      id: "extensions/registerPanel",
      title: "Register extension panel",
      description: "Creates a panel from an extension's declared panel contribution.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: extensionPanelAvailability,
      inputSchema: {
        type: "object",
        required: ["extensionId"],
        properties: {
          extensionId: { type: "string", description: "Extension id whose panel contribution should be registered." },
          panelId: { type: "string", description: "Optional declared panel id. Defaults to the first contribution." },
          order: { type: "number", description: "Optional panel order override." }
        }
      },
      outputSchema: plasticEventSchema,
      examples: [
        {
          title: "Register a bundled chat panel",
          input: { extensionId: "plastic.chat" },
          expectedEvents: ["panel.created"],
          verifyWith: { method: "panels/list", input: {} }
        }
      ],
      effects: {
        durableEvents: ["panel.created"],
        mutatesProjection: ["panels", "windows"]
      },
      reversibility: {
        reversible: true,
        method: "panels/close",
        notes: "Close or remove the created panel by id."
      },
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
                scope: { panelId: contribution.id, extensionId: extension.id },
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
