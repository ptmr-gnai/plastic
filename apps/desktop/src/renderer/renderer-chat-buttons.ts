import type {
  ChatButton,
  PlasticPanel
} from "./panel-renderer-api.js";

export const createChatButtonBuilder = (input: {
  chatPanels: PlasticPanel[];
  addedButtons: ChatButton[];
}) => (chatId: string): ChatButton[] => {
  const peer = input.chatPanels.find((panel) => panel.id !== chatId);
  const peerButtons: ChatButton[] = peer ? [{
    id: `send-to-${peer.id}`,
    label: `Send to ${peer.title}`,
    action: {
      method: "panels/sendMessage",
      input: {
        fromPanelId: chatId,
        toPanelId: peer.id,
        messageType: "chat",
        content: `Message from ${chatId} at ${new Date().toLocaleTimeString()}.`
      }
    }
  }] : [];

  return [
    {
      id: `new-chat-${chatId}`,
      label: "New chat",
      action: {
        method: "chats/createCodexChat",
        input: {}
      }
    },
    {
      id: `summarize-${chatId}`,
      label: "Summarize",
      action: {
        method: "chats/sendToCodex",
        input: {
          chatId,
          content: "Summarize this chat and suggest next steps."
        }
      }
    },
    ...peerButtons,
    ...input.addedButtons.filter((button) => {
      const actionInput = button.action.input as { chatId?: string } | undefined;
      return actionInput?.chatId === undefined || actionInput.chatId === chatId;
    })
  ];
};
