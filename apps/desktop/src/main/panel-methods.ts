import { Effect } from "effect";
import {
  projectPanelMessages,
  projectPanels
} from "@plastic/core";
import type { RuntimeMethodContext } from "./runtime-method-context.js";

type PanelMailboxContext = Pick<RuntimeMethodContext, "eventStore" | "methods" | "runPromise" | "appendEvent">;

export const registerPanelMailboxMethods = async (input: PanelMailboxContext) => {
  const { eventStore, methods, runPromise, appendEvent } = input;

  await runPromise(
    methods.register({
      id: "panels/sendMessage",
      title: "Send panel message",
      description: "Sends a durable mailbox message from one panel to another.",
      owner: { kind: "runtime", id: "plastic.runtime" },
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

  await runPromise(
    methods.register({
      id: "panels/listMessages",
      title: "List panel messages",
      description: "Lists durable panel mailbox messages, optionally filtered by panel id.",
      owner: { kind: "runtime", id: "plastic.runtime" },
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

  await runPromise(
    methods.register({
      id: "panels/markMessageRead",
      title: "Mark panel message read",
      owner: { kind: "runtime", id: "plastic.runtime" },
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

  await runPromise(
    methods.register({
      id: "panels/mailboxes",
      title: "Panel mailboxes",
      description: "Returns panels with inbox/outbox message counts.",
      owner: { kind: "runtime", id: "plastic.runtime" },
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
