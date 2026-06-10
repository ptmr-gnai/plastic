import "./styles.css";
import { createExtensionRendererFromContribution } from "./extension-renderer-registry.js";
import { createChatButtonBuilder } from "./renderer-chat-buttons.js";
import { bindRendererEvents } from "./renderer-events.js";
import {
  createPanelRendererRegistry,
  resolvePanelRenderer
} from "./renderer-panel-registry.js";
import { renderWorkspaceHtml } from "./renderer-workspace-html.js";
import type {
  ChatBinding,
  ChatButton,
  ChatMessage,
  PlasticPanel
} from "./panel-renderer-api.js";
import {
  buttonFromEvent,
  callPlastic,
  escapeHtml,
  type CodexStatus,
  type PlasticEvent,
  type PlasticExtension,
  type PlasticSnapshot,
  type PlasticState
} from "./renderer-client.js";
import {
  renderAgentDevPanel,
  renderCodexPanel
} from "./renderer-system-panels.js";

let lastRenderedEventCount = -1;
let topbarCollapsed = window.localStorage.getItem("plastic.topbarCollapsed") === "true";
let renderInFlight: Promise<void> | null = null;
let renderQueued = false;
let renderQueuedForce = false;

const isNearBottom = (element: HTMLElement) =>
  element.scrollHeight - element.scrollTop - element.clientHeight < 48;

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
    .map(buttonFromEvent)
    .filter((button): button is ChatButton => Boolean(button));

  document.documentElement.dataset.theme = state.app.theme;

  const panelRenderers = createPanelRendererRegistry({
    extensions,
    renderCodexPanel: () => renderCodexPanel(codexStatus),
    renderAgentDevPanel: () => renderAgentDevPanel({ snapshot, methods, panels, state, codexStatus })
  });
  const rendererForPanel = (panel: PlasticPanel) => resolvePanelRenderer({ panel, extensions, panelRenderers });

  const chatPanels = panels.filter((panel) => rendererForPanel(panel).panelKinds.includes("chat"));
  const buildChatButtons = createChatButtonBuilder({ chatPanels, addedButtons });
  const agentDevPanelVisible = panels.some((panel) => rendererForPanel(panel).id === "plastic.agent-dev.panel");
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

  root.innerHTML = renderWorkspaceHtml({ topbarCollapsed, state, methods, panels, rendererForPanel });

  bindRendererEvents({
    root,
    panels,
    chatPanels,
    buildChatButtons,
    getTopbarCollapsed: () => topbarCollapsed,
    setTopbarCollapsed: (collapsed) => {
      topbarCollapsed = collapsed;
    },
    render
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
