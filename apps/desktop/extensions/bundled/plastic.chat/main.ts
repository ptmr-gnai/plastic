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
};
