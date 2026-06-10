import type { PlasticPanel } from "./panel-renderer-api.js";
import {
  escapeHtml,
  type CodexStatus,
  type PlasticSnapshot,
  type PlasticState
} from "./renderer-client.js";

export const renderCodexPanel = (codexStatus: CodexStatus) => `
  <p>Status: ${codexStatus.connected ? "connected" : "disconnected"}${codexStatus.initialized ? " and initialized" : ""}</p>
  <p>PID: ${codexStatus.pid ?? "none"} · Pending: ${codexStatus.pendingRequests}</p>
  <div class="flow-row">
    <button data-action="codex-connect" data-plastic-command="codex/initialize">Connect</button>
  </div>
`;

export const renderAgentDevPanel = (input: {
  snapshot: PlasticSnapshot | null;
  methods: Array<{ id: string }>;
  panels: PlasticPanel[];
  state: PlasticState;
  codexStatus: CodexStatus;
}) => {
  const visibleRefs = input.snapshot?.visibleRefs.flatMap((windowRefs) => windowRefs.refs) ?? [];
  const recentRefs = visibleRefs.filter((ref) => ref.ref).slice(0, 10);
  return `
    <div class="dev-grid" data-plastic-ref="agent-dev:summary">
      <p><span>Build</span>${escapeHtml(input.snapshot?.build.status ?? "unknown")}</p>
      <p><span>Methods</span>${input.snapshot?.methods.count ?? input.methods.length}</p>
      <p><span>Panels</span>${input.snapshot?.panels.length ?? input.panels.length}</p>
      <p><span>Refs</span>${visibleRefs.length}</p>
      <p><span>Events</span>${input.snapshot?.events.count ?? input.state.events.count}</p>
      <p><span>Codex</span>${input.snapshot?.codex.initialized ? "initialized" : input.codexStatus.initialized ? "initialized" : "idle"}</p>
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
    <p class="muted" data-plastic-ref="agent-dev:latest-event">Latest event: ${escapeHtml(input.snapshot?.events.latest?.type ?? "none")}</p>
  `;
};
