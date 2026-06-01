import "./styles.css";
import { createExtensionRendererFromContribution } from "./extension-renderer-registry.js";
import type {
  ChatBinding,
  ChatButton,
  ChatMessage,
  PanelRenderer,
  PlasticPanel
} from "./panel-renderer-api.js";

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

type PlasticExtension = {
  id: string;
  title: string;
  path?: string;
  renderers: Array<{
    id: string;
    title?: string;
    module?: string;
    panelKinds: string[];
  }>;
};

type CodexStatus = {
  connected: boolean;
  initialized: boolean;
  pid: number | null;
  pendingRequests: number;
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
let renderInFlight: Promise<void> | null = null;
let renderQueued = false;
let renderQueuedForce = false;

const isNearBottom = (element: HTMLElement) =>
  element.scrollHeight - element.scrollTop - element.clientHeight < 48;

const genericPanelRenderer = (id: string, extensionId: string, panelKinds: string[] = ["generic"]): PanelRenderer => ({
  id,
  extensionId,
  panelKinds,
  closeMethod: "panels/close",
  closeInputKey: "id",
  render: ({ panel }) => `<p>${escapeHtml(panel.body ?? "This panel is projected from the durable event stream.")}</p>`
});

const renderNow = async (force = false) => {
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
  const methods = await callPlastic("plastic/methods") as Array<{ id: string }>;
  const panels = await callPlastic("panels/list") as PlasticPanel[];
  const extensions = await callPlastic("extensions/list") as PlasticExtension[];
  const codexStatus = await callPlastic("codex/status") as CodexStatus;
  if (!force && state.events.count === lastRenderedEventCount) {
    return;
  }
  lastRenderedEventCount = state.events.count;
  const buttonEvents = await callPlastic("events/list", { types: ["panel.button.added"], limit: 100 }) as PlasticEvent[];
  const addedButtons = buttonEvents
    .map((event) => (event.payload as { button?: ChatButton }).button)
    .filter((button): button is ChatButton => Boolean(button));

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

  document.documentElement.dataset.theme = state.app.theme;

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

  const panelRenderers = new Map<string, PanelRenderer>([
    [
      "plastic.codex.runtime-panel",
      {
        id: "plastic.codex.runtime-panel",
        extensionId: "plastic.codex",
        panelKinds: ["agent-runtime"],
        closeMethod: "panels/close",
        closeInputKey: "id",
        render: renderCodexPanel
      }
    ],
    [
      "plastic.agent-dev.panel",
      {
        id: "plastic.agent-dev.panel",
        extensionId: "plastic.agent-dev",
        panelKinds: ["agent-dev"],
        closeMethod: "panels/close",
        closeInputKey: "id",
        render: renderAgentDevPanel
      }
    ],
    [
      "plastic.document.markdown-panel",
      genericPanelRenderer("plastic.document.markdown-panel", "plastic.document", ["document"])
    ],
    [
      "plastic.tasks.tasks-panel",
      genericPanelRenderer("plastic.tasks.tasks-panel", "plastic.tasks", ["tasks"])
    ],
    [
      "plastic.generic.panel",
      genericPanelRenderer("plastic.generic.panel", "plastic.runtime")
    ]
  ]);

  for (const extension of extensions) {
    for (const contribution of extension.renderers) {
      if (panelRenderers.has(contribution.id)) {
        continue;
      }
      const renderer = createExtensionRendererFromContribution(extension.path, contribution, {
        chat: () => ({
          buttons: [],
          messages: [],
          binding: undefined,
          peer: undefined,
          escapeHtml
        })
      }) ?? genericPanelRenderer(contribution.id, extension.id, contribution.panelKinds);
      panelRenderers.set(contribution.id, renderer);
    }
  }

  const resolvePanelRenderer = (panel: PlasticPanel): PanelRenderer => {
    if (panel.rendererId && panelRenderers.has(panel.rendererId)) {
      return panelRenderers.get(panel.rendererId) ?? panelRenderers.get("plastic.generic.panel")!;
    }

    const extension = extensions.find((candidate) => candidate.id === panel.extensionId);
    const rendererContribution = extension?.renderers.find((renderer) => renderer.panelKinds.includes(panel.kind))
      ?? extension?.renderers[0];
    if (rendererContribution && panelRenderers.has(rendererContribution.id)) {
      return panelRenderers.get(rendererContribution.id) ?? panelRenderers.get("plastic.generic.panel")!;
    }

    return panelRenderers.get("plastic.generic.panel")!;
  };

  const chatPanels = panels.filter((panel) => resolvePanelRenderer(panel).id === "plastic.chat.chat-panel");
  const agentDevPanelVisible = panels.some((panel) => resolvePanelRenderer(panel).id === "plastic.agent-dev.panel");
  const snapshot = agentDevPanelVisible ? await callPlastic("plastic/snapshot") as PlasticSnapshot : null;
  const chatBindings = new Map<string, ChatBinding>(
    await Promise.all(chatPanels.map(async (panel) => {
      const binding = await callPlastic("chats/getBinding", { chatId: panel.id }) as ChatBinding;
      return [panel.id, binding] as const;
    }))
  );
  const chatMessageLists = new Map<string, ChatMessage[]>(
    await Promise.all(chatPanels.map(async (panel) => {
      const messages = await callPlastic("chats/messages", { chatId: panel.id, limit: 80 }) as ChatMessage[];
      return [panel.id, messages] as const;
    }))
  );
  for (const extension of extensions) {
    for (const contribution of extension.renderers) {
      const renderer = createExtensionRendererFromContribution(extension.path, contribution, {
        chat: (panel) => ({
          buttons: buildChatButtons(panel.id),
          messages: chatMessageLists.get(panel.id) ?? [],
          binding: chatBindings.get(panel.id),
          peer: chatPanels.find((candidate) => candidate.id !== panel.id),
          escapeHtml
        })
      });
      if (renderer) {
        panelRenderers.set(contribution.id, renderer);
      }
    }
  }

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
        ${panels.map((panel) => {
          const renderer = resolvePanelRenderer(panel);
          return `
          <article class="panel" data-plastic-ref="panel:${escapeHtml(panel.id)}" data-plastic-panel="${escapeHtml(panel.id)}" data-plastic-extension="${escapeHtml(panel.extensionId)}">
            <header class="panel-header">
              <div>
                <p class="eyebrow">${escapeHtml(panel.subtitle ?? panel.kind)}</p>
                <h2>${escapeHtml(panel.title)}</h2>
              </div>
              <button
                class="panel-close"
                data-close-panel="${escapeHtml(panel.id)}"
                data-close-method="${escapeHtml(renderer.closeMethod)}"
                data-close-input-key="${escapeHtml(renderer.closeInputKey)}"
                data-plastic-command="${escapeHtml(renderer.closeMethod)}"
              >Close</button>
            </header>
            ${renderer.render({ panel })}
          </article>
        `;
        }).join("")}
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
      const method = button.dataset.closeMethod ?? "panels/close";
      const inputKey = button.dataset.closeInputKey ?? "id";
      const input = { [inputKey]: panelId };
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

const render = async (force = false): Promise<void> => {
  renderQueuedForce = renderQueuedForce || force;

  if (renderInFlight) {
    renderQueued = true;
    return renderInFlight;
  }

  renderInFlight = (async () => {
    try {
      do {
        const forceNextRender = renderQueuedForce;
        renderQueued = false;
        renderQueuedForce = false;
        await renderNow(forceNextRender);
      } while (renderQueued);
    } finally {
      renderInFlight = null;
    }
  })();

  return renderInFlight;
};

void render(true);
const events = new EventSource("http://127.0.0.1:7331/events/stream");
events.addEventListener("plastic.event", () => {
  void render();
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
