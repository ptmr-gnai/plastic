import { Effect } from "effect";
import {
  type EventStore,
  type MethodRegistry,
} from "@plastic/core";
import { scanBundledExtensions } from "./extension-discovery.js";
import { registerExtensionActivationMethods } from "./extension-activation-methods.js";
import { registerExtensionForkMethods } from "./extension-fork-methods.js";
import { registerExtensionPanelMethods } from "./extension-panel-methods.js";
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
  await registerExtensionForkMethods(input);
  await registerExtensionPanelMethods(input);
};
