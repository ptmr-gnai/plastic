import type { ChatMessage, ChatPanelRendererContext, PanelRenderer } from "../../../apps/desktop/src/renderer/panel-renderer-api.js";

const labelForRole = (role: ChatMessage["role"]) => {
  if (role === "agent") {
    return "Codex";
  }
  if (role === "peer") {
    return "Peer";
  }
  if (role === "user") {
    return "You";
  }
  return "System";
};

const renderChatPanel = ({ panel, buttons, messages, binding, peer, escapeHtml }: ChatPanelRendererContext) => {
  const turnRunning = binding?.activeTurnStatus === "inProgress";

  return `
    <section class="chat-shell" data-plastic-ref="chat-shell:${escapeHtml(panel.id)}">
      <div class="chat-status" data-plastic-ref="chat-status:${escapeHtml(panel.id)}">
        <span>Forked</span>
        <span>${escapeHtml(binding?.runtimeId ?? "codex")}</span>
        <span>${binding?.threadId ? `Thread ${escapeHtml(binding.threadId.slice(0, 8))}` : "No thread"}</span>
        <span>${binding?.activeTurnStatus ? `Turn ${escapeHtml(binding.activeTurnStatus)}` : "Idle"}</span>
        ${turnRunning ? `<button data-chat-interrupt="${escapeHtml(panel.id)}" data-plastic-command="chats/interrupt">Stop</button>` : ""}
      </div>
      <details class="chat-actions" data-plastic-ref="chat-buttons:${escapeHtml(panel.id)}">
        <summary>Actions</summary>
        <div class="flow-row">
          ${buttons.map((button) => `
            <button
              data-chat-button="${escapeHtml(button.id)}"
              data-plastic-ref="panel-button:${escapeHtml(button.id)}"
              data-plastic-command="${escapeHtml(button.action.method)}"
            >${escapeHtml(button.label)}</button>
          `).join("")}
        </div>
      </details>
      <div class="chat-log" data-chat-log="${escapeHtml(panel.id)}" data-plastic-ref="chat-log:${escapeHtml(panel.id)}">
        ${messages.length > 0 ? messages.map((message) => `
          <div class="chat-message-row chat-message-row-${message.role}" data-plastic-ref="${escapeHtml(message.id)}">
            <div class="chat-message chat-message-${message.role}">
              <span>${labelForRole(message.role)}</span>
              <div class="chat-message-content">${escapeHtml(message.content.trim())}</div>
              ${message.streaming ? `<em>Streaming...</em>` : ""}
            </div>
          </div>
        `).join("") : `<p class="muted chat-empty">${peer ? `This chat can send panel messages to ${escapeHtml(peer.title)}.` : "Messages will appear here."}</p>`}
      </div>
      <form class="chat-compose" data-chat-compose="${escapeHtml(panel.id)}" data-plastic-ref="chat-compose:${escapeHtml(panel.id)}">
        <textarea name="content" rows="1" placeholder="Message ${escapeHtml(panel.title)}"></textarea>
        <button type="submit" data-plastic-command="chats/sendToCodex">Send</button>
      </form>
    </section>
  `;
};

export const renderer: PanelRenderer = {
  id: "workspace.chat-fork.chat-panel",
  extensionId: "workspace.chat-fork",
  panelKinds: ["chat"],
  closeMethod: "chats/close",
  closeInputKey: "chatId",
  render: (context) => renderChatPanel(context as ChatPanelRendererContext)
};
