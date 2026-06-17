export const assertChatMethodDescriptions = ({ assert, descriptions }) => {
  assert(descriptions.binding.outputSchema?.required?.includes("chatId"), "chats/getBinding output schema must require chatId");
  assert(descriptions.binding.outputSchema?.required?.includes("threadId"), "chats/getBinding output schema must require threadId");
  assert(descriptions.binding.outputSchema?.required?.includes("activeTurnId"), "chats/getBinding output schema must require activeTurnId");
  assert(descriptions.create.outputSchema?.required?.includes("panelId"), "chats/createCodexChat output schema must require panelId");
  assert(descriptions.create.outputSchema?.required?.includes("panelEvent"), "chats/createCodexChat output schema must require panelEvent");
  assert(descriptions.create.outputSchema?.properties?.panelEvent?.required?.includes("id"), "chats/createCodexChat panelEvent schema must expose id");
  assert(descriptions.send.outputSchema?.properties?.userMessage?.required?.includes("id"), "chats/sendToCodex userMessage schema must expose id");
  assert(descriptions.send.outputSchema?.properties?.userEvent?.required?.includes("id"), "chats/sendToCodex userEvent schema must expose id");
  assert(descriptions.send.effects?.durableEvents?.includes("chat.user_message.submitted"), "chats/sendToCodex must describe submitted message events");
  assert(descriptions.bind.outputSchema?.required?.includes("threadId"), "chats/bindCodexThread output schema must require threadId");
  assert(descriptions.start.outputSchema?.required?.includes("threadId"), "chats/startCodexThread output schema must require threadId");
  assert(descriptions.interrupt.outputSchema, "chats/interrupt output schema must be present");
  assert(descriptions.close.outputSchema?.required?.includes("closedEvent"), "chats/close output schema must require closedEvent");
};
