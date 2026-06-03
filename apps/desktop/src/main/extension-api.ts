import type { Effect } from "effect";
import type {
  buildChatMessagesForPanel,
  createEvent,
  projectPanels,
  EventStore,
  MethodRegistry,
  PlasticEvent,
  PlasticExtension,
  PlasticMethod
} from "@plastic/core";

export interface ExtensionActivationContext {
  extension: PlasticExtension;
  workspaceDir: string;
  eventStore: EventStore;
  methods: MethodRegistry;
  Effect: typeof Effect;
  core: {
    buildChatMessagesForPanel: typeof buildChatMessagesForPanel;
    createEvent: typeof createEvent;
    projectPanels: typeof projectPanels;
  };
  registerMethod: (method: PlasticMethod) => Promise<PlasticMethod>;
  listMethods: () => Promise<PlasticMethod[]>;
  appendEvent: (event: Parameters<typeof createEvent>[0]) => Promise<PlasticEvent>;
  listEvents: () => Promise<PlasticEvent[]>;
  mapEvents: <A>(project: (events: PlasticEvent[]) => A) => Effect.Effect<A, unknown>;
}

export type PlasticExtensionModule = {
  activate?: (context: ExtensionActivationContext) => unknown | Promise<unknown>;
};
