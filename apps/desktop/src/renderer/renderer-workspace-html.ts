import type {
  PanelRenderer,
  PlasticPanel
} from "./panel-renderer-api.js";
import {
  escapeHtml,
  type PlasticState
} from "./renderer-client.js";

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

const renderPanelArticle = (input: {
  panel: PlasticPanel;
  renderer: PanelRenderer;
}) => {
  const { panel, renderer } = input;
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
};

const runtimePortLabel = (state: PlasticState) =>
  String(state.controlPlane?.runtime?.port ?? "unknown");

const buildPortLabel = (state: PlasticState) =>
  String(state.controlPlane?.build?.port ?? "unknown");

export const renderWorkspaceHtml = (input: {
  topbarCollapsed: boolean;
  state: PlasticState;
  methods: Array<{ id: string }>;
  panels: PlasticPanel[];
  rendererForPanel: (panel: PlasticPanel) => PanelRenderer;
}) => `
  <section class="workspace ${input.topbarCollapsed ? "workspace-topbar-collapsed" : ""}" data-plastic-ref="workspace:default">
    <header class="topbar" data-plastic-ref="runtime:topbar">
      <div>
        <p class="eyebrow">Plastic</p>
        <h1>Agent-native workspace</h1>
        <p class="status">Runtime socket <code>${escapeHtml(runtimePortLabel(input.state))}</code> · Build socket <code>${escapeHtml(buildPortLabel(input.state))}</code> · Events ${input.state.events.count} · Methods ${input.methods.length}</p>
      </div>
      <div class="topbar-actions">
        <button data-action="theme" data-theme="light" data-plastic-command="app/setTheme">Light</button>
        <button data-action="theme" data-theme="dark" data-plastic-command="app/setTheme">Dark</button>
        <button data-action="toggle-topbar" data-plastic-ref="topbar:toggle">${input.topbarCollapsed ? "Show" : "Hide"}</button>
      </div>
    </header>
    <header class="topbar-mini" data-plastic-ref="runtime:topbar-mini">
      <strong>Plastic</strong>
      <span>Events ${input.state.events.count} · Methods ${input.methods.length}</span>
      <button data-action="toggle-topbar" data-plastic-ref="topbar:toggle-mini">Show</button>
    </header>
    <div class="rail" data-plastic-ref="window-layout:main">
      ${input.panels.map((panel) => renderPanelArticle({ panel, renderer: input.rendererForPanel(panel) })).join("")}
      <article class="panel add-panel" data-plastic-ref="panel:add">
        ${renderAddPanelControls()}
      </article>
    </div>
  </section>
`;
