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
  role: "user" | "agent" | "system" | "peer";
  streaming?: boolean;
};

type CodexStatus = {
  connected: boolean;
  initialized: boolean;
  pid: number | null;
  pendingRequests: number;
};

type ChatBinding = {
  chatId: string;
  runtimeId: string;
  threadId: string | null;
  activeTurnId: string | null;
  activeTurnStatus: string | null;
};

type PlasticSnapshot = {
  build: {
    status: string;
    viteUrl: string | null;
  };
  runtime: {
    windowCount: number;
    eventStreamClientCount: number;
  };
  codex: CodexStatus;
  methods: {
    count: number;
  };
  panels: PlasticPanel[];
  extensions: Array<{ id: string; title: string; errors: string[] }>;
  visibleRefs: Array<{ windowId: number; refs: Array<{ ref?: string; panel?: string; command?: string; text: string }> }>;
  events: {
    count: number;
    latest: { type: string; timestamp: string } | null;
  };
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
let topbarCollapsed = window.localStorage.getItem("plastic.topbarCollapsed") === "true";

const isNearBottom = (element: HTMLElement) =>
  element.scrollHeight - element.scrollTop - element.clientHeight < 48;

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

const render = async (force = false) => {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (!root) {
    return;
  }

  const chatScroll = new Map<string, { top: number; stickToBottom: boolean }>();
  root.querySelectorAll<HTMLElement>("[data-chat-log]").forEach((element) => {
    const chatId = element.dataset.chatLog;
    if (!chatId) {
      return;
    }
    chatScroll.set(chatId, {
      top: element.scrollTop,
      stickToBottom: isNearBottom(element)
    });
  });

  const state = await callPlastic("plastic/state") as PlasticState;
  const events = await callPlastic("events/list") as PlasticEvent[];
  const methods = await callPlastic("plastic/methods") as Array<{ id: string }>;
  const panels = await callPlastic("panels/list") as PlasticPanel[];
  const codexStatus = await callPlastic("codex/status") as CodexStatus;
  const agentDevPanelVisible = panels.some((panel) => panel.kind === "agent-dev");
  const snapshot = agentDevPanelVisible ? await callPlastic("plastic/snapshot") as PlasticSnapshot : null;
  if (!force && events.length === lastRenderedEventCount) {
    return;
  }
  lastRenderedEventCount = events.length;
  const addedButtons = events
    .filter((event) => event.type === "panel.button.added")
    .map((event) => (event.payload as { button?: ChatButton }).button)
    .filter((button): button is ChatButton => Boolean(button));
  const chatPanels = panels.filter((panel) => panel.kind === "chat");
  const chatBindings = new Map<string, ChatBinding>(
    await Promise.all(chatPanels.map(async (panel) => {
      const binding = await callPlastic("chats/getBinding", { chatId: panel.id }) as ChatBinding;
      return [panel.id, binding] as const;
    }))
  );

  const buildChatButtons = (chatId: string): ChatButton[] => {
    const peer = chatPanels.find((panel) => panel.id !== chatId);
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
      ...addedButtons.filter((button) => {
        const input = button.action.input as { chatId?: string } | undefined;
        return input?.chatId === undefined || input.chatId === chatId;
      })
    ];
  };

  const buildChatMessages = (chatId: string) => {
    const agentMessages = new Map<string, ChatMessage>();
    const messages = events.flatMap<ChatMessage>((event, index) => {
      const payload = event.payload as {
        chatId?: string;
        fromPanelId?: string;
        toPanelId?: string;
        content?: string;
        itemId?: string;
        delta?: string;
        status?: string;
        error?: { message?: string };
      };

      if ((event.type === "chat.user_message.injected" || event.type === "chat.user_message.submitted") && payload.chatId === chatId) {
        return [{
          id: `message-${chatId}-${index}`,
          role: "user",
          content: payload.content ?? ""
        } satisfies ChatMessage];
      }

      if (event.type === "panel.message.sent" && payload.toPanelId === chatId) {
        return [{
          id: `panel-message-${chatId}-${index}`,
          role: "peer",
          content: `${payload.fromPanelId}: ${payload.content ?? ""}`
        } satisfies ChatMessage];
      }

      if (event.type === "chat.agent_message.delta" && payload.chatId === chatId) {
        const id = payload.itemId ?? `agent-${chatId}-${index}`;
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

      if (event.type === "chat.agent_message.completed" && payload.chatId === chatId) {
        const id = payload.itemId ?? `agent-${chatId}-${index}`;
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

      if (event.type === "chat.codex_turn.completed" && payload.chatId === chatId && payload.status === "failed") {
        return [{
          id: `turn-${chatId}-${index}`,
          role: "system",
          content: payload.error?.message ?? "Codex turn failed."
        } satisfies ChatMessage];
      }

      return [];
    });
    messages.push(...agentMessages.values());
    return messages;
  };
  document.documentElement.dataset.theme = state.app.theme;

  const renderChatPanel = (panel: PlasticPanel) => {
    const chatButtons = buildChatButtons(panel.id);
    const chatMessages = buildChatMessages(panel.id);
    const binding = chatBindings.get(panel.id);
    const turnRunning = binding?.activeTurnStatus === "inProgress";
    const peer = chatPanels.find((candidate) => candidate.id !== panel.id);
    return `
    <section class="chat-shell" data-plastic-ref="chat-shell:${escapeHtml(panel.id)}">
      <div class="chat-status" data-plastic-ref="chat-status:${escapeHtml(panel.id)}">
        <span>${escapeHtml(binding?.runtimeId ?? "codex")}</span>
        <span>${binding?.threadId ? `Thread ${escapeHtml(binding.threadId.slice(0, 8))}` : "No thread"}</span>
        <span>${binding?.activeTurnStatus ? `Turn ${escapeHtml(binding.activeTurnStatus)}` : "Idle"}</span>
        ${turnRunning ? `<button data-chat-interrupt="${escapeHtml(panel.id)}" data-plastic-command="chats/interrupt">Stop</button>` : ""}
      </div>
      <details class="chat-actions" data-plastic-ref="chat-buttons:${escapeHtml(panel.id)}">
        <summary>Actions</summary>
        <div class="flow-row">
          ${chatButtons.map((button) => `
            <button
              data-chat-button="${escapeHtml(button.id)}"
              data-plastic-ref="panel-button:${escapeHtml(button.id)}"
              data-plastic-command="${escapeHtml(button.action.method)}"
            >${escapeHtml(button.label)}</button>
          `).join("")}
        </div>
      </details>
      <div class="chat-log" data-chat-log="${escapeHtml(panel.id)}" data-plastic-ref="chat-log:${escapeHtml(panel.id)}">
        ${chatMessages.length > 0 ? chatMessages.map((message) => `
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

  const renderCodexPanel = () => `
    <p>Status: ${codexStatus.connected ? "connected" : "disconnected"}${codexStatus.initialized ? " and initialized" : ""}</p>
    <p>PID: ${codexStatus.pid ?? "none"} · Pending: ${codexStatus.pendingRequests}</p>
    <div class="flow-row">
      <button data-action="codex-connect" data-plastic-command="codex/initialize">Connect</button>
    </div>
  `;

  const renderAgentDevPanel = () => {
    const visibleRefs = snapshot?.visibleRefs.flatMap((windowRefs) => windowRefs.refs) ?? [];
    const recentRefs = visibleRefs.filter((ref) => ref.ref).slice(0, 10);
    return `
      <div class="dev-grid" data-plastic-ref="agent-dev:summary">
        <p><span>Build</span>${escapeHtml(snapshot?.build.status ?? "unknown")}</p>
        <p><span>Methods</span>${snapshot?.methods.count ?? methods.length}</p>
        <p><span>Panels</span>${snapshot?.panels.length ?? panels.length}</p>
        <p><span>Refs</span>${visibleRefs.length}</p>
        <p><span>Events</span>${snapshot?.events.count ?? state.events.count}</p>
        <p><span>Codex</span>${snapshot?.codex.initialized ? "initialized" : codexStatus.initialized ? "initialized" : "idle"}</p>
      </div>
      <div class="flow-row">
        <button data-action="self-test" data-plastic-command="plastic/selfTest">Self-test</button>
        <button data-action="reload-renderer" data-plastic-command="renderer/reload">Reload</button>
        <button data-action="scan-extensions" data-plastic-command="extensions/scan">Scan extensions</button>
      </div>
      <div class="dev-list" data-plastic-ref="agent-dev:refs">
        ${recentRefs.map((ref) => `
          <button data-scroll-ref="${escapeHtml(ref.ref ?? "")}" data-plastic-command="windows/scrollToRef">
            ${escapeHtml(ref.ref ?? "ref")}
          </button>
        `).join("")}
      </div>
      <p class="muted" data-plastic-ref="agent-dev:latest-event">Latest event: ${escapeHtml(snapshot?.events.latest?.type ?? "none")}</p>
    `;
  };

  const renderPanelBody = (panel: PlasticPanel) => {
    if (panel.kind === "chat") {
      return renderChatPanel(panel);
    }

    if (panel.kind === "agent-runtime" && panel.id === "codex") {
      return renderCodexPanel();
    }

    if (panel.kind === "agent-dev") {
      return renderAgentDevPanel();
    }

    return `<p>${escapeHtml(panel.body ?? "This panel is projected from the durable event stream.")}</p>`;
  };

  const renderAddPanelControls = () => `
    <h2>Add panel</h2>
    <p>Ask an agent to create a new panel, button, workflow, or extension. New panels accumulate to the right.</p>
    <div class="flow-row">
      <button data-action="create-chat" data-plastic-command="chats/createCodexChat">New chat</button>
      <button data-action="create-document" data-plastic-command="panels/create">Document</button>
      <button data-action="create-tasks" data-plastic-command="panels/create">Tasks</button>
      <button data-action="create-panel" data-plastic-command="panels/create">Generic</button>
    </div>
  `;

  root.innerHTML = `
    <section class="workspace ${topbarCollapsed ? "workspace-topbar-collapsed" : ""}" data-plastic-ref="workspace:default">
      <header class="topbar" data-plastic-ref="runtime:topbar">
        <div>
          <p class="eyebrow">Plastic</p>
          <h1>Agent-native workspace</h1>
          <p class="status">Runtime socket <code>7331</code> · Build socket <code>7332</code> · Events ${state.events.count} · Methods ${methods.length}</p>
        </div>
        <div class="topbar-actions">
          <button data-action="theme" data-theme="light" data-plastic-command="app/setTheme">Light</button>
          <button data-action="theme" data-theme="dark" data-plastic-command="app/setTheme">Dark</button>
          <button data-action="toggle-topbar" data-plastic-ref="topbar:toggle">${topbarCollapsed ? "Show" : "Hide"}</button>
        </div>
      </header>
      <header class="topbar-mini" data-plastic-ref="runtime:topbar-mini">
        <strong>Plastic</strong>
        <span>Events ${state.events.count} · Methods ${methods.length}</span>
        <button data-action="toggle-topbar" data-plastic-ref="topbar:toggle-mini">Show</button>
      </header>
      <div class="rail" data-plastic-ref="window-layout:main">
        ${panels.map((panel) => `
          <article class="panel" data-plastic-ref="panel:${escapeHtml(panel.id)}" data-plastic-panel="${escapeHtml(panel.id)}" data-plastic-extension="${escapeHtml(panel.extensionId)}">
            <header class="panel-header">
              <div>
                <p class="eyebrow">${escapeHtml(panel.subtitle ?? panel.kind)}</p>
                <h2>${escapeHtml(panel.title)}</h2>
              </div>
              <button class="panel-close" data-close-panel="${escapeHtml(panel.id)}" data-panel-kind="${escapeHtml(panel.kind)}" data-plastic-command="${panel.kind === "chat" ? "chats/close" : "panels/close"}">Close</button>
            </header>
            ${renderPanelBody(panel)}
          </article>
        `).join("")}
        <article class="panel add-panel" data-plastic-ref="panel:add">
          ${renderAddPanelControls()}
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

  root.querySelectorAll<HTMLButtonElement>("[data-action='toggle-topbar']").forEach((button) => {
    button.addEventListener("click", async () => {
      topbarCollapsed = !topbarCollapsed;
      window.localStorage.setItem("plastic.topbarCollapsed", String(topbarCollapsed));
      await render(true);
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-chat-button]").forEach((button) => {
    button.addEventListener("click", async () => {
      const chatButton = chatPanels
        .flatMap((panel) => buildChatButtons(panel.id))
        .find((candidate) => candidate.id === button.dataset.chatButton);
      if (!chatButton) {
        return;
      }
      const result = await callPlastic(chatButton.action.method, chatButton.action.input) as { panelId?: string } | undefined;
      await render(true);
      if (chatButton.action.method === "chats/createCodexChat" && result?.panelId) {
        await callPlastic("windows/focusPanel", { panelId: result.panelId });
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-chat-interrupt]").forEach((button) => {
    button.addEventListener("click", async () => {
      const chatId = button.dataset.chatInterrupt;
      if (!chatId) {
        return;
      }
      await callPlastic("chats/interrupt", { chatId });
      await render(true);
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-close-panel]").forEach((button) => {
    button.addEventListener("click", async () => {
      const panelId = button.dataset.closePanel;
      if (!panelId) {
        return;
      }
      const method = button.dataset.panelKind === "chat" ? "chats/close" : "panels/close";
      const input = button.dataset.panelKind === "chat" ? { chatId: panelId } : { id: panelId };
      await callPlastic(method, input);
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

  root.querySelector<HTMLButtonElement>("[data-action='create-chat']")?.addEventListener("click", async () => {
    const result = await callPlastic("chats/createCodexChat", {}) as { panelId?: string };
    await render(true);
    if (result.panelId) {
      await callPlastic("windows/focusPanel", { panelId: result.panelId });
    }
  });

  root.querySelector<HTMLButtonElement>("[data-action='create-document']")?.addEventListener("click", async () => {
    await callPlastic("panels/create", {
      title: "Document",
      kind: "document",
      extensionId: "plastic.document",
      subtitle: "Markdown editor and preview",
      body: "The document panel starts as a projection of durable document events.",
      order: panels.length + 1
    });
    await render(true);
  });

  root.querySelector<HTMLButtonElement>("[data-action='create-tasks']")?.addEventListener("click", async () => {
    await callPlastic("panels/create", {
      title: "Tasks",
      kind: "tasks",
      extensionId: "plastic.tasks",
      subtitle: "Tasks and recurring work",
      body: "Recurring tasks can learn from usage and propose new buttons or flows.",
      order: panels.length + 1
    });
    await render(true);
  });

  root.querySelector<HTMLButtonElement>("[data-action='self-test']")?.addEventListener("click", async () => {
    await callPlastic("plastic/selfTest", {});
    await render(true);
  });

  root.querySelector<HTMLButtonElement>("[data-action='reload-renderer']")?.addEventListener("click", async () => {
    await callPlastic("renderer/reload", {});
  });

  root.querySelector<HTMLButtonElement>("[data-action='scan-extensions']")?.addEventListener("click", async () => {
    await callPlastic("extensions/scan", {});
    await render(true);
  });

  root.querySelectorAll<HTMLButtonElement>("[data-scroll-ref]").forEach((button) => {
    button.addEventListener("click", async () => {
      const ref = button.dataset.scrollRef;
      if (!ref) {
        return;
      }
      await callPlastic("windows/scrollToRef", { ref });
    });
  });

  root.querySelectorAll<HTMLFormElement>(".chat-compose").forEach((compose) => {
    compose.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const chatId = form.dataset.chatCompose ?? "chat-main";
      const content = new FormData(form).get("content")?.toString() ?? "";
      if (content.trim().length === 0) {
        return;
      }
      await callPlastic("chats/sendToCodex", {
        chatId,
        content
      });
      form.reset();
      await render(true);
    });

    compose.querySelector<HTMLTextAreaElement>("textarea")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) {
        return;
      }
      event.preventDefault();
      compose.requestSubmit();
    });
  });

  root.querySelectorAll<HTMLElement>("[data-chat-log]").forEach((element) => {
    const chatId = element.dataset.chatLog;
    const scroll = chatId ? chatScroll.get(chatId) : undefined;
    element.scrollTop = scroll ? scroll.stickToBottom ? element.scrollHeight : scroll.top : element.scrollHeight;
  });
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
