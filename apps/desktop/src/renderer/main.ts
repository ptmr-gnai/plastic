import "./styles.css";

type PlasticState = {
  app: {
    name: "Plastic";
    theme: "light" | "dark";
  };
  events: {
    count: number;
    latest: string | null;
  };
  resources: Array<{
    id: string;
    kind: string;
    title?: string;
    state: unknown;
    actions: Array<{ id: string; title: string; method: string }>;
  }>;
};

type PlasticEvent = {
  type: string;
  payload: unknown;
};

type PlasticPanel = {
  id: string;
  title: string;
  kind: string;
  extensionId: string;
  subtitle?: string;
  body?: string;
  order: number;
};

type ChatButton = {
  id: string;
  label: string;
  action: {
    method: string;
    input?: unknown;
  };
};

type ChatMessage = {
  id: string;
  content: string;
  role: "user" | "agent" | "system";
  streaming?: boolean;
};

type CodexStatus = {
  connected: boolean;
  initialized: boolean;
  pid: number | null;
  pendingRequests: number;
};

const escapeHtml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const callPlastic = async (method: string, input?: unknown): Promise<unknown> => {
  if (window.plastic) {
    return window.plastic.call(method, input);
  }

  const response = await fetch("http://127.0.0.1:7331/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, input })
  });
  const result = await response.json() as { ok: true; value: unknown } | { ok: false; error: string };
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.value;
};

let lastRenderedEventCount = -1;

const isNearBottom = (element: HTMLElement) =>
  element.scrollHeight - element.scrollTop - element.clientHeight < 48;

const render = async (force = false) => {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (!root) {
    return;
  }

  const existingChatLog = root.querySelector<HTMLElement>("[data-plastic-ref='chat-log:chat-main']");
  const chatScroll = existingChatLog ? {
    top: existingChatLog.scrollTop,
    stickToBottom: isNearBottom(existingChatLog)
  } : null;

  const state = await callPlastic("plastic/state") as PlasticState;
  const events = await callPlastic("events/list") as PlasticEvent[];
  const methods = await callPlastic("plastic/methods") as Array<{ id: string }>;
  const panels = await callPlastic("panels/list") as PlasticPanel[];
  const codexStatus = await callPlastic("codex/status") as CodexStatus;
  if (!force && events.length === lastRenderedEventCount) {
    return;
  }
  lastRenderedEventCount = events.length;
  const addedButtons = events
    .filter((event) => event.type === "panel.button.added")
    .map((event) => (event.payload as { button?: ChatButton }).button)
    .filter((button): button is ChatButton => Boolean(button));
  const chatButtons = [
    {
      id: "summarize-project",
      label: "Summarize project",
      action: {
        method: "chats/sendToCodex",
        input: {
          chatId: "chat-main",
          content: "Summarize the current project and suggest next steps."
        }
      }
    },
    {
      id: "make-task-list",
      label: "Make task list",
      action: {
        method: "chats/sendToCodex",
        input: {
          chatId: "chat-main",
          content: "Turn the current conversation into a task list."
        }
      }
    },
    ...addedButtons
  ];
  const agentMessages = new Map<string, ChatMessage>();
  const chatMessages = events.flatMap<ChatMessage>((event, index) => {
    if (event.type === "chat.user_message.injected" || event.type === "chat.user_message.submitted") {
      return [{
        id: `message-${index}`,
        role: "user",
        content: (event.payload as { content?: string }).content ?? ""
      } satisfies ChatMessage];
    }

    if (event.type === "chat.agent_message.delta") {
      const payload = event.payload as { itemId?: string; delta?: string };
      const id = payload.itemId ?? `agent-${index}`;
      const existing = agentMessages.get(id) ?? {
        id,
        role: "agent",
        content: "",
        streaming: true
      } satisfies ChatMessage;
      existing.content += payload.delta ?? "";
      existing.streaming = true;
      agentMessages.set(id, existing);
      return [];
    }

    if (event.type === "chat.agent_message.completed") {
      const payload = event.payload as { itemId?: string; content?: string };
      const id = payload.itemId ?? `agent-${index}`;
      const existing = agentMessages.get(id) ?? {
        id,
        role: "agent",
        content: "",
        streaming: false
      } satisfies ChatMessage;
      existing.content = payload.content ?? existing.content;
      existing.streaming = false;
      agentMessages.set(id, existing);
      return [];
    }

    if (event.type === "chat.codex_turn.completed") {
      const payload = event.payload as { status?: string; error?: { message?: string } };
      if (payload.status === "failed") {
        return [{
          id: `turn-${index}`,
          role: "system",
          content: payload.error?.message ?? "Codex turn failed."
        } satisfies ChatMessage];
      }
    }

    return [];
  });
  chatMessages.push(...agentMessages.values());
  document.documentElement.dataset.theme = state.app.theme;

  const renderChatPanel = () => `
    <div class="flow-row" data-plastic-ref="chat-buttons:chat-main">
      ${chatButtons.map((button) => `
        <button
          data-chat-button="${escapeHtml(button.id)}"
          data-plastic-ref="panel-button:${escapeHtml(button.id)}"
          data-plastic-command="${escapeHtml(button.action.method)}"
        >${escapeHtml(button.label)}</button>
      `).join("")}
    </div>
    <div class="chat-log" data-plastic-ref="chat-log:chat-main">
      ${chatMessages.length > 0 ? chatMessages.map((message) => `
        <p class="chat-message chat-message-${message.role}" data-plastic-ref="${escapeHtml(message.id)}">
          <span>${message.role === "agent" ? "Codex" : message.role === "user" ? "You" : "System"}</span>
          ${escapeHtml(message.content)}${message.streaming ? `<em>Streaming...</em>` : ""}
        </p>
      `).join("") : `<p class="muted">Injected user messages will appear here.</p>`}
    </div>
    <form class="chat-compose" data-plastic-ref="chat-compose:chat-main">
      <textarea name="content" rows="4" placeholder="Message Codex through Plastic"></textarea>
      <button type="submit" data-plastic-command="chats/sendToCodex">Send</button>
    </form>
  `;

  const renderCodexPanel = () => `
    <p>Status: ${codexStatus.connected ? "connected" : "disconnected"}${codexStatus.initialized ? " and initialized" : ""}</p>
    <p>PID: ${codexStatus.pid ?? "none"} · Pending: ${codexStatus.pendingRequests}</p>
    <div class="flow-row">
      <button data-action="codex-connect" data-plastic-command="codex/initialize">Connect</button>
    </div>
  `;

  const renderPanelBody = (panel: PlasticPanel) => {
    if (panel.kind === "chat") {
      return renderChatPanel();
    }

    if (panel.kind === "agent-runtime" && panel.id === "codex") {
      return renderCodexPanel();
    }

    return `<p>${escapeHtml(panel.body ?? "This panel is projected from the durable event stream.")}</p>`;
  };

  root.innerHTML = `
    <section class="workspace" data-plastic-ref="workspace:default">
      <header class="topbar" data-plastic-ref="runtime:topbar">
        <div>
          <p class="eyebrow">Plastic</p>
          <h1>Agent-native workspace</h1>
          <p class="status">Runtime socket <code>7331</code> · Build socket <code>7332</code> · Events ${state.events.count} · Methods ${methods.length}</p>
        </div>
        <div class="topbar-actions">
          <button data-action="theme" data-theme="light" data-plastic-command="app/setTheme">Light</button>
          <button data-action="theme" data-theme="dark" data-plastic-command="app/setTheme">Dark</button>
        </div>
      </header>
      <div class="rail" data-plastic-ref="window-layout:main">
        ${panels.map((panel) => `
          <article class="panel" data-plastic-ref="panel:${escapeHtml(panel.id)}" data-plastic-panel="${escapeHtml(panel.id)}" data-plastic-extension="${escapeHtml(panel.extensionId)}">
            <header class="panel-header">
              <div>
                <p class="eyebrow">${escapeHtml(panel.subtitle ?? panel.kind)}</p>
                <h2>${escapeHtml(panel.title)}</h2>
              </div>
            </header>
            ${renderPanelBody(panel)}
          </article>
        `).join("")}
        <article class="panel add-panel" data-plastic-ref="panel:add">
          <h2>Add panel</h2>
          <p>Ask an agent to create a new panel, button, workflow, or extension. New panels accumulate to the right.</p>
          <div class="flow-row">
            <button data-action="create-panel" data-plastic-command="panels/create">Create panel</button>
          </div>
        </article>
      </div>
    </section>
  `;

  root.querySelectorAll<HTMLButtonElement>("[data-action='theme']").forEach((button) => {
    button.addEventListener("click", async () => {
      await callPlastic("app/setTheme", { theme: button.dataset.theme });
      await render(true);
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-chat-button]").forEach((button) => {
    button.addEventListener("click", async () => {
      const chatButton = chatButtons.find((candidate) => candidate.id === button.dataset.chatButton);
      if (!chatButton) {
        return;
      }
      await callPlastic(chatButton.action.method, chatButton.action.input);
      await render(true);
    });
  });

  root.querySelector<HTMLButtonElement>("[data-action='codex-connect']")?.addEventListener("click", async () => {
    await callPlastic("codex/initialize", {});
    await render(true);
  });

  root.querySelector<HTMLButtonElement>("[data-action='create-panel']")?.addEventListener("click", async () => {
    await callPlastic("panels/create", {
      title: "New panel",
      kind: "generic",
      extensionId: "plastic.user",
      body: "Created from the GUI through panels/create.",
      order: panels.length + 1
    });
    await render(true);
  });

  root.querySelector<HTMLFormElement>(".chat-compose")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const content = new FormData(form).get("content")?.toString() ?? "";
    if (content.trim().length === 0) {
      return;
    }
    await callPlastic("chats/sendToCodex", {
      chatId: "chat-main",
      content
    });
    form.reset();
    await render(true);
  });

  const nextChatLog = root.querySelector<HTMLElement>("[data-plastic-ref='chat-log:chat-main']");
  if (nextChatLog && chatScroll) {
    nextChatLog.scrollTop = chatScroll.stickToBottom ? nextChatLog.scrollHeight : chatScroll.top;
  } else if (nextChatLog) {
    nextChatLog.scrollTop = nextChatLog.scrollHeight;
  }
};

void render(true);
const events = new EventSource("http://127.0.0.1:7331/events/stream");
events.addEventListener("plastic.event", () => {
  void render(true);
});

events.onerror = () => {
  window.setTimeout(() => {
    void render();
  }, 1000);
};

window.addEventListener("message", (event) => {
  if (event.data?.type !== "plastic:listVisibleRefs") {
    return;
  }

  const refs = [...document.querySelectorAll<HTMLElement>("[data-plastic-ref]")].map((element) => ({
    ref: element.dataset.plasticRef,
    panel: element.dataset.plasticPanel,
    extension: element.dataset.plasticExtension,
    command: element.dataset.plasticCommand,
    tag: element.tagName.toLowerCase(),
    text: element.innerText.slice(0, 240)
  }));

  event.source?.postMessage({ type: "plastic:visibleRefs", refs }, { targetOrigin: "*" });
});
