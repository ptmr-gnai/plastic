import type { ExtensionActivationContext } from "../../../src/main/extension-api.js";

const extensionLink = (context: ExtensionActivationContext) => ({
  rel: "extension",
  href: "extensions/get",
  method: "extensions/get",
  target: context.extension.id
});

const chatExtensionAvailability = {
  status: "available" as const,
  notes: "Bundled chat projection/control methods are extension runtime primitives available in headed and headless modes."
};

const registerMessages = (context: ExtensionActivationContext) =>
  context.registerMethod({
    id: "chats/messages",
    title: "Chat messages",
    description: "Returns the bounded chat transcript projection for one chat panel without exposing raw stream deltas to the renderer.",
    owner: { kind: "extension", id: context.extension.id },
    availability: chatExtensionAvailability,
    links: [extensionLink(context)],
    handler: (input) =>
      context.mapEvents((events) => context.core.buildChatMessagesForPanel(events, input))
  });

const registerAddButton = (context: ExtensionActivationContext) =>
  context.registerMethod({
    id: "chats/addButton",
    title: "Add chat button",
    description: "Add a durable action button to chat panels.",
    owner: { kind: "extension", id: context.extension.id },
    availability: chatExtensionAvailability,
    links: [extensionLink(context)],
    handler: (input) => {
      const chatId = input?.chatId ?? "chat-main";
      const button = input?.button;
      if (!button?.id || !button.label || !button.action?.method) {
        throw new Error("chats/addButton requires button.id, button.label, and button.action.method");
      }

      return context.Effect.promise(() =>
        context.appendEvent({
          type: "panel.button.added",
          payload: { panelId: chatId, button },
          scope: { panelId: chatId, extensionId: context.extension.id }
        })
      );
    }
  });

const registerInjectUserMessage = (context: ExtensionActivationContext) =>
  context.registerMethod({
    id: "chats/injectUserMessage",
    title: "Inject user message",
    description: "Append a user-message event to a chat transcript.",
    owner: { kind: "extension", id: context.extension.id },
    availability: chatExtensionAvailability,
    links: [extensionLink(context)],
    handler: (input) => {
      const chatId = input?.chatId ?? "chat-main";
      if (!input?.content) {
        throw new Error("chats/injectUserMessage requires content");
      }

      return context.Effect.promise(() =>
        context.appendEvent({
          type: "chat.user_message.injected",
          payload: { chatId, content: input.content },
          scope: { panelId: chatId, extensionId: context.extension.id }
        })
      );
    }
  });

const hasHostOverride = async (context: ExtensionActivationContext, methodId: string) =>
  (await context.listMethods()).some((method) =>
    method.id === methodId && !(method.owner.kind === "extension" && method.owner.id === context.extension.id)
  );

const registerCreateChat = async (context: ExtensionActivationContext) => {
  if (await hasHostOverride(context, "chats/createCodexChat")) {
    return;
  }
  await context.registerMethod({
    id: "chats/createCodexChat",
    title: "Create chat",
    description: "Create a new chat panel. Host-specific Codex adapters may override this with thread binding.",
    owner: { kind: "extension", id: context.extension.id },
    availability: chatExtensionAvailability,
    links: [extensionLink(context)],
    handler: () =>
      context.Effect.promise(async () => {
        const id = `chat-${crypto.randomUUID().slice(0, 8)}`;
        const panels = context.core.projectPanels(await context.listEvents());
        await context.appendEvent({
          type: "panel.created",
          payload: {
            id,
            title: `Chat ${panels.filter((panel) => panel.kind === "chat").length + 1}`,
            kind: "chat",
            extensionId: context.extension.id,
            rendererId: "plastic.chat.chat-panel",
            subtitle: "Conversation surface",
            order: panels.length + 1
          },
          scope: { panelId: id, extensionId: context.extension.id }
        });
        return { panelId: id, chatId: id };
      })
  });
};

const registerCloseChat = async (context: ExtensionActivationContext) => {
  if (await hasHostOverride(context, "chats/close")) {
    return;
  }
  await context.registerMethod({
    id: "chats/close",
    title: "Close chat",
    description: "Close a chat panel by removing it from the projected panel set.",
    owner: { kind: "extension", id: context.extension.id },
    availability: chatExtensionAvailability,
    links: [extensionLink(context)],
    handler: (input) => {
      const id = input?.chatId;
      if (!id) {
        throw new Error("chats/close requires chatId");
      }
      return context.Effect.promise(() =>
        context.appendEvent({
          type: "panel.removed",
          payload: { id },
          scope: { panelId: id, extensionId: context.extension.id }
        })
      );
    }
  });
};

export const activate = async (context: ExtensionActivationContext) => {
  await registerMessages(context);
  await registerAddButton(context);
  await registerInjectUserMessage(context);
  await registerCreateChat(context);
  await registerCloseChat(context);
};
