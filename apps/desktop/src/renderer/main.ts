import "./styles.css";

type PlasticState = {
  app: {
    name: "Plastic";
    theme: "light" | "dark";
  };
  resources: Array<{
    id: string;
    kind: string;
    title?: string;
    state: unknown;
    actions: Array<{ id: string; title: string; method: string }>;
  }>;
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

const render = async () => {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (!root) {
    return;
  }

  const state = await window.plastic.call("plastic/state") as PlasticState;
  document.documentElement.dataset.theme = state.app.theme;

  root.innerHTML = `
    <section class="workspace" data-plastic-ref="workspace:default">
      <header class="topbar" data-plastic-ref="runtime:topbar">
        <div>
          <p class="eyebrow">Plastic</p>
          <h1>Agent-native workspace</h1>
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
                <button data-plastic-command="chats/injectUserMessage">Summarize project</button>
                <button data-plastic-command="chats/injectUserMessage">Make task list</button>
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
      await window.plastic.call("app/setTheme", { theme: button.dataset.theme });
      await render();
    });
  });
};

void render();

