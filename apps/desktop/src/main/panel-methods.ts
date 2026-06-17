import { Effect } from "effect";
import {
  projectPanelMessages,
  projectPanels
} from "@plastic/core";
import { noInputSchema, readOnlyEffects, readOnlyReversibility } from "./runtime-method-metadata.js";
import type { RuntimeMethodContext, RuntimeModule } from "./runtime-method-context.js";
import { plasticEventSchema } from "./runtime-control-schemas.js";

type PanelMailboxContext = Pick<RuntimeMethodContext, "eventStore" | "methods" | "runPromise" | "appendEvent">;

const panelMailboxAvailability = {
  status: "available" as const,
  notes: "Panel mailbox is a durable runtime primitive available in headed and headless modes."
};

const panelMessageSchema = {
  type: "object",
  required: ["id", "fromPanelId", "toPanelId", "type", "timestamp", "status"],
  properties: {
    id: { type: "string" },
    fromPanelId: { type: "string" },
    toPanelId: { type: "string" },
    type: { type: "string" },
    content: { type: "string" },
    payload: {},
    timestamp: { type: "string" },
    status: { type: "string", enum: ["sent", "read"] }
  }
};

const panelMailboxSummarySchema = {
  type: "object",
  required: ["panel", "inboxCount", "outboxCount", "unreadCount"],
  properties: {
    panel: { type: "object" },
    inboxCount: { type: "number" },
    outboxCount: { type: "number" },
    unreadCount: { type: "number" }
  }
};

export const registerPanelMailboxMethods = async (input: PanelMailboxContext) => {
  await registerSendPanelMessage(input);
  await registerListPanelMessages(input);
  await registerMarkPanelMessageRead(input);
  await registerPanelMailboxes(input);
};

const registerSendPanelMessage = async (input: PanelMailboxContext) => {
  const { methods, runPromise, appendEvent } = input;

  await runPromise(
    methods.register({
      id: "panels/sendMessage",
      title: "Send panel message",
      description: "Sends a durable mailbox message from one panel to another.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: panelMailboxAvailability,
      inputSchema: {
        type: "object",
        required: ["fromPanelId", "toPanelId"],
        properties: {
          fromPanelId: { type: "string", description: "Panel id sending the message." },
          toPanelId: { type: "string", description: "Panel id receiving the message." },
          messageType: { type: "string", description: "Message type. Defaults to text." },
          content: { type: "string", description: "Optional human-readable message content." },
          payload: { type: "object", description: "Optional structured message payload." }
        }
      },
      outputSchema: plasticEventSchema,
      examples: [
        {
          title: "Send a message between panels",
          input: { fromPanelId: "chat-main", toPanelId: "tasks-main", content: "Please review this." },
          expectedEvents: ["panel.message.sent"],
          verifyWith: { method: "panels/listMessages", input: { panelId: "tasks-main" } }
        }
      ],
      effects: {
        durableEvents: ["panel.message.sent"],
        mutatesProjection: ["panelMessages"]
      },
      reversibility: {
        reversible: false,
        notes: "Mailbox messages are durable; compensate by sending a follow-up message."
      },
      handler: (methodInput) => {
        const messageInput = methodInput as {
          fromPanelId?: string;
          toPanelId?: string;
          messageType?: string;
          content?: string;
          payload?: unknown;
        };
        if (!messageInput.fromPanelId || !messageInput.toPanelId) {
          throw new Error("panels/sendMessage requires fromPanelId and toPanelId");
        }
        const fromPanelId = messageInput.fromPanelId;
        const toPanelId = messageInput.toPanelId;

        return Effect.promise(() =>
          appendEvent({
            type: "panel.message.sent",
            payload: {
              id: crypto.randomUUID(),
              fromPanelId,
              toPanelId,
              messageType: messageInput.messageType ?? "text",
              content: messageInput.content,
              payload: messageInput.payload
            },
            scope: { panelId: toPanelId },
            meta: {
              links: [
                { rel: "source-panel", href: "panels/get", method: "panels/get", target: fromPanelId },
                { rel: "target-panel", href: "panels/get", method: "panels/get", target: toPanelId }
              ]
            }
          })
        );
      }
    })
  );
};

const registerListPanelMessages = async (input: PanelMailboxContext) => {
  const { eventStore, methods, runPromise } = input;

  await runPromise(
    methods.register({
      id: "panels/listMessages",
      title: "List panel messages",
      description: "Lists durable panel mailbox messages, optionally filtered by panel id.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: panelMailboxAvailability,
      inputSchema: {
        type: "object",
        properties: {
          panelId: { type: "string", description: "Optional panel id to filter inbox and outbox messages." }
        }
      },
      outputSchema: { type: "array", items: panelMessageSchema },
      examples: [
        {
          title: "List messages for one panel",
          input: { panelId: "chat-main" },
          verifyWith: { method: "panels/mailboxes", input: {} }
        }
      ],
      effects: readOnlyEffects,
      reversibility: readOnlyReversibility,
      handler: (methodInput) =>
        Effect.map(eventStore.list(), (events) => {
          const panelId = (methodInput as { panelId?: string } | undefined)?.panelId;
          const messages = projectPanelMessages(events);
          if (!panelId) {
            return messages;
          }
          return messages.filter((message) => message.fromPanelId === panelId || message.toPanelId === panelId);
        })
    })
  );
};

const registerMarkPanelMessageRead = async (input: PanelMailboxContext) => {
  const { methods, runPromise, appendEvent } = input;

  await runPromise(
    methods.register({
      id: "panels/markMessageRead",
      title: "Mark panel message read",
      description: "Appends a durable read receipt for a panel mailbox message.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: panelMailboxAvailability,
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "Mailbox message id to mark read." }
        }
      },
      outputSchema: plasticEventSchema,
      examples: [
        {
          title: "Mark a mailbox message read",
          input: { id: "message-id" },
          expectedEvents: ["panel.message.read"],
          verifyWith: { method: "panels/listMessages", input: {} }
        }
      ],
      effects: {
        durableEvents: ["panel.message.read"],
        mutatesProjection: ["panelMessages"]
      },
      reversibility: {
        reversible: false,
        notes: "Read receipts are durable; compensate by sending or appending a later status event."
      },
      handler: (methodInput) => {
        const id = (methodInput as { id?: string }).id;
        if (!id) {
          throw new Error("panels/markMessageRead requires id");
        }
        return Effect.promise(() =>
          appendEvent({
            type: "panel.message.read",
            payload: { id }
          })
        );
      }
    })
  );
};

const registerPanelMailboxes = async (input: PanelMailboxContext) => {
  const { eventStore, methods, runPromise } = input;

  await runPromise(
    methods.register({
      id: "panels/mailboxes",
      title: "Panel mailboxes",
      description: "Returns panels with inbox/outbox message counts.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: panelMailboxAvailability,
      inputSchema: noInputSchema,
      outputSchema: { type: "array", items: panelMailboxSummarySchema },
      examples: [
        {
          title: "Read mailbox counts",
          input: {},
          verifyWith: { method: "panels/listMessages", input: {} }
        }
      ],
      effects: readOnlyEffects,
      reversibility: readOnlyReversibility,
      handler: () =>
        Effect.map(eventStore.list(), (events) => {
          const panels = projectPanels(events);
          const messages = projectPanelMessages(events);
          return panels.map((panel) => ({
            panel,
            inboxCount: messages.filter((message) => message.toPanelId === panel.id).length,
            outboxCount: messages.filter((message) => message.fromPanelId === panel.id).length,
            unreadCount: messages.filter((message) => message.toPanelId === panel.id && message.status !== "read").length
          }));
        })
    })
  );
};

export const panelMailboxModule: RuntimeModule = {
  id: "panel-mailbox",
  register: registerPanelMailboxMethods
};
