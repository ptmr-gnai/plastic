import type {
  ChatButton,
  PlasticPanel
} from "./panel-renderer-api.js";
import { callPlastic } from "./renderer-client.js";

type BindRendererEventsInput = {
  root: HTMLElement;
  panels: PlasticPanel[];
  chatPanels: PlasticPanel[];
  buildChatButtons: (chatId: string) => ChatButton[];
  getTopbarCollapsed: () => boolean;
  setTopbarCollapsed: (collapsed: boolean) => void;
  render: (force?: boolean) => Promise<void>;
};

const bindTopbarEvents = (input: BindRendererEventsInput) => {
  const { root, render } = input;

  root.querySelectorAll<HTMLButtonElement>("[data-action='theme']").forEach((button) => {
    button.addEventListener("click", async () => {
      await callPlastic("app/setTheme", { theme: button.dataset.theme });
      await render(true);
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-action='toggle-topbar']").forEach((button) => {
    button.addEventListener("click", async () => {
      const topbarCollapsed = !input.getTopbarCollapsed();
      input.setTopbarCollapsed(topbarCollapsed);
      window.localStorage.setItem("plastic.topbarCollapsed", String(topbarCollapsed));
      await render(true);
    });
  });
};

const bindChatEvents = (input: BindRendererEventsInput) => {
  const { root, chatPanels, buildChatButtons, render } = input;

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
};

const bindPanelLifecycleEvents = (input: BindRendererEventsInput) => {
  const { root, panels, render } = input;

  root.querySelectorAll<HTMLButtonElement>("[data-close-panel]").forEach((button) => {
    button.addEventListener("click", async () => {
      const panelId = button.dataset.closePanel;
      if (!panelId) {
        return;
      }
      const method = button.dataset.closeMethod ?? "panels/close";
      const inputKey = button.dataset.closeInputKey ?? "id";
      const methodInput = { [inputKey]: panelId };
      await callPlastic(method, methodInput);
      await render(true);
    });
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
};

const bindDevControlEvents = (input: BindRendererEventsInput) => {
  const { root, render } = input;

  root.querySelector<HTMLButtonElement>("[data-action='codex-connect']")?.addEventListener("click", async () => {
    await callPlastic("codex/initialize", {});
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
};

const bindChatComposeEvents = (input: BindRendererEventsInput) => {
  const { root, render } = input;

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
};

export const bindRendererEvents = (input: BindRendererEventsInput) => {
  bindTopbarEvents(input);
  bindChatEvents(input);
  bindPanelLifecycleEvents(input);
  bindDevControlEvents(input);
  bindChatComposeEvents(input);
};
