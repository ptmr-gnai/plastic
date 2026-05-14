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
};

const panels = [
  {
    id: "chat-main",
    title: "Chat",
    subtitle: "Markdown conversation surface",
    body: "Agent messages and user messages will land in Plastic's shared event stream."
  },
  {
    id: "doc-main",
    title: "Document",
    subtitle: "Markdown editor and preview",
    body: "The document panel starts as a projection of durable document events."
  },
  {
    id: "tasks-main",
    title: "Tasks",
    subtitle: "Tasks and recurring work",
    body: "Recurring tasks can learn from usage and propose new buttons or flows."
  }
];

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

const render = async (force = false) => {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (!root) {
    return;
  }

  const state = await callPlastic("plastic/state") as PlasticState;
  const events = await callPlastic("events/list") as PlasticEvent[];
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
        method: "chats/injectUserMessage",
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
        method: "chats/injectUserMessage",
        input: {
          chatId: "chat-main",
          content: "Turn the current conversation into a task list."
        }
      }
    },
    ...addedButtons
  ];
  const chatMessages = events
    .filter((event) => event.type === "chat.user_message.injected")
    .map((event, index) => ({
      id: `message-${index}`,
      content: (event.payload as { content?: string }).content ?? ""
    } satisfies ChatMessage));
  document.documentElement.dataset.theme = state.app.theme;

  root.innerHTML = `
    <section class="workspace" data-plastic-ref="workspace:default">
      <header class="topbar" data-plastic-ref="runtime:topbar">
        <div>
          <p class="eyebrow">Plastic</p>
          <h1>Agent-native workspace</h1>
          <p class="status">Runtime socket <code>7331</code> · Build socket <code>7332</code> · Events ${state.events.count}</p>
        </div>
        <div class="topbar-actions">
          <button data-action="theme" data-theme="light" data-plastic-command="app/setTheme">Light</button>
          <button data-action="theme" data-theme="dark" data-plastic-command="app/setTheme">Dark</button>
        </div>
      </header>
      <div class="rail" data-plastic-ref="window-layout:main">
        ${panels.map((panel) => `
          <article class="panel" data-plastic-ref="panel:${panel.id}" data-plastic-panel="${panel.id}">
            <header class="panel-header">
              <div>
                <p class="eyebrow">${panel.subtitle}</p>
                <h2>${panel.title}</h2>
              </div>
            </header>
            ${panel.id === "chat-main" ? `
              <div class="flow-row" data-plastic-ref="chat-buttons:chat-main">
                ${chatButtons.map((button) => `
                  <button
                    data-chat-button="${button.id}"
                    data-plastic-ref="panel-button:${button.id}"
                    data-plastic-command="${button.action.method}"
                  >${button.label}</button>
                `).join("")}
              </div>
              <div class="chat-log" data-plastic-ref="chat-log:chat-main">
                ${chatMessages.length > 0 ? chatMessages.map((message) => `
                  <p class="chat-message" data-plastic-ref="${message.id}">${message.content}</p>
                `).join("") : `<p class="muted">Injected user messages will appear here.</p>`}
              </div>
            ` : ""}
            <p>${panel.body}</p>
          </article>
        `).join("")}
        <article class="panel add-panel" data-plastic-ref="panel:add">
          <h2>Add panel</h2>
          <p>Ask an agent to create a new panel, button, workflow, or extension. New panels accumulate to the right.</p>
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
};

void render(true);
window.setInterval(() => {
  void render();
}, 1000);

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
