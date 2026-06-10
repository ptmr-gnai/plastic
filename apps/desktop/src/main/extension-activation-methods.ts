import { Effect } from "effect";
import {
  projectExtensions,
  type EventStore,
  type MethodRegistry
} from "@plastic/core";
import { activateExtensions } from "./extension-host.js";
import type { RunPromise } from "./runtime-method-context.js";

export const registerExtensionActivationMethods = async (input: {
  workspaceDir: string;
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
}) => {
  const { workspaceDir, eventStore, methods, runPromise } = input;

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
};
