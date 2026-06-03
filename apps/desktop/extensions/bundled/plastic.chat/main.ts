export const activate = async (context) => {
  await context.registerMethod({
    id: "chats/messages",
    title: "Chat messages",
    description: "Returns the bounded chat transcript projection for one chat panel without exposing raw stream deltas to the renderer.",
    owner: { kind: "extension", id: context.extension.id },
    links: [
      { rel: "extension", href: "extensions/get", method: "extensions/get", target: context.extension.id }
    ],
    handler: (input) =>
      context.mapEvents((events) => context.core.buildChatMessagesForPanel(events, input))
  });

  await context.registerMethod({
    id: "chats/addButton",
    title: "Add chat button",
    description: "Add a durable action button to chat panels.",
    owner: { kind: "extension", id: context.extension.id },
    links: [
      { rel: "extension", href: "extensions/get", method: "extensions/get", target: context.extension.id }
    ],
    handler: (input) => {
      const chatId = input?.chatId ?? "chat-main";
      const button = input?.button;
      if (!button?.id || !button.label || !button.action?.method) {
        throw new Error("chats/addButton requires button.id, button.label, and button.action.method");
      }

      return context.Effect.promise(() =>
        context.appendEvent({
          type: "panel.button.added",
          payload: {
            panelId: chatId,
            button
          },
          scope: { panelId: chatId, extensionId: context.extension.id }
        })
      );
    }
  });

  await context.registerMethod({
    id: "chats/injectUserMessage",
    title: "Inject user message",
    description: "Append a user-message event to a chat transcript.",
    owner: { kind: "extension", id: context.extension.id },
    links: [
      { rel: "extension", href: "extensions/get", method: "extensions/get", target: context.extension.id }
    ],
    handler: (input) => {
      const chatId = input?.chatId ?? "chat-main";
      if (!input?.content) {
        throw new Error("chats/injectUserMessage requires content");
      }

      return context.Effect.promise(() =>
        context.appendEvent({
          type: "chat.user_message.injected",
          payload: {
            chatId,
            content: input.content
          },
          scope: { panelId: chatId, extensionId: context.extension.id }
        })
      );
    }
  });
};
