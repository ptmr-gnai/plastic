import {
  buildTimeline,
  isNoisyEvent,
  projectExtensions,
  projectPanels,
  type PlasticEvent,
  type TimelineInput
} from "@plastic/core";
import type { DeixisMethodHost } from "./deixis-methods.js";
import type { RuntimeMethodContext } from "./runtime-method-context.js";

const findRecentEvents = (events: PlasticEvent[], predicate: (event: PlasticEvent) => boolean, limit = 20) =>
  events.filter(predicate).slice(-limit);

export const resolveDeixisRef = async (input: {
  ref: string;
  events: Array<PlasticEvent>;
  host: Pick<DeixisMethodHost, "panelIdFromRef" | "resolveVisibleRef" | "sourceHintsFor">;
  methods: RuntimeMethodContext["methods"];
  runPromise: RuntimeMethodContext["runPromise"];
}) => {
  const { events, host, methods, ref, runPromise } = input;
  const panels = projectPanels(events);
  const extensions = projectExtensions(events);
  const visible = await host.resolveVisibleRef(ref);
  const panelId = visible?.ref.panel ?? host.panelIdFromRef(ref);
  const panel = panelId ? panels.find((candidate) => candidate.id === panelId) : undefined;
  const extensionId = visible?.ref.extension ?? panel?.extensionId;
  const extension = extensionId ? extensions.find((candidate) => candidate.id === extensionId) : undefined;
  const isChatCompose = ref.startsWith("chat-compose:");
  const command = visible?.ref.command ?? (isChatCompose ? "chats/sendToCodex" : undefined);
  const lineage = findRecentEvents(
    events,
    (event) =>
      !isNoisyEvent(event) && (
        event.scope.panelId === panelId ||
        event.scope.extensionId === extensionId ||
        event.type.includes(panelId ?? "__no_panel__") ||
        event.type.includes(extensionId ?? "__no_extension__")
      ),
    12
  );
  const refTimelineInput: TimelineInput = { limit: 12 };
  if (panelId) {
    refTimelineInput.scope = { panelId };
  }
  const timeline = buildTimeline(events, refTimelineInput);
  const binding = panelId && panel?.kind === "chat"
    ? await runPromise(methods.call("chats/getBinding", { chatId: panelId })).catch((error) => ({
      error: error instanceof Error ? error.message : String(error)
    }))
    : null;

  const sourceHintInput: { ref?: string; panelId?: string; extensionId?: string; command?: string } = { ref };
  if (panelId) {
    sourceHintInput.panelId = panelId;
  }
  if (extensionId) {
    sourceHintInput.extensionId = extensionId;
  }
  if (command) {
    sourceHintInput.command = command;
  }

  return {
    ref,
    element: visible ? {
      windowId: visible.windowId,
      tag: visible.ref.tag,
      text: visible.ref.text,
      bounds: visible.ref.bounds ?? null,
      attributes: {
        "data-plastic-ref": visible.ref.ref ?? ref,
        ...(visible.ref.panel ? { "data-plastic-panel": visible.ref.panel } : {}),
        ...(visible.ref.extension ? { "data-plastic-extension": visible.ref.extension } : {}),
        ...(visible.ref.command ? { "data-plastic-command": visible.ref.command } : {})
      }
    } : null,
    visible,
    ownership: {
      panelId: panelId ?? null,
      extensionId: extensionId ?? null,
      methodId: command ?? null,
      commandId: command ?? null,
      agentId: panel?.kind === "chat" ? "codex" : null
    },
    state: {
      panel: panel ?? null,
      extension: extension ?? null,
      binding,
      timeline,
      resourceLinks: [
        ...(panelId ? [{ rel: "panel", href: "panels/get", method: "panels/get", target: panelId }] : []),
        ...(extensionId ? [{ rel: "extension", href: "extensions/get", method: "extensions/get", target: extensionId }] : []),
        ...(panelId ? [{ rel: "timeline", href: "events/timeline", method: "events/timeline", target: panelId }] : [])
      ]
    },
    panel,
    extension,
    command,
    sourceHints: host.sourceHintsFor(sourceHintInput),
    lineage,
    verification: [
      ...(panelId ? [
        { id: "verify-ref-action", title: "Verify ref action", method: "deixis/verifyRefAction", input: { ref, panelId, limit: 30 } },
        { id: "timeline-after-action", title: "Verify panel timeline", method: "events/timeline", input: { scope: { panelId }, limit: 12 } }
      ] : []),
      { id: "visible-after-action", title: "Verify visible refs", method: "deixis/listVisibleRefs" },
      { id: "screenshot-after-action", title: "Verify screenshot", method: "windows/screenshot", input: { ref } }
    ],
    actions: [
      ...(panelId ? [
        { id: "get-panel", title: "Get panel", method: "panels/get", input: { id: panelId } },
        { id: "rename-panel", title: "Rename panel", method: "panels/rename" }
      ] : []),
      ...(isChatCompose && panelId ? [
        { id: "fill-compose", title: "Fill chat compose", method: "deixis/fillRef", input: { ref, value: "" } },
        { id: "send-compose", title: "Submit chat compose", method: "deixis/clickRef", input: { ref } },
        { id: "send-chat-direct", title: "Send chat message directly", method: "chats/sendToCodex", input: { chatId: panelId, content: "" } }
      ] : []),
      ...(extensionId ? [
        { id: "get-extension", title: "Get extension", method: "extensions/get", input: { id: extensionId } }
      ] : []),
      ...(command ? [
        { id: "invoke-command", title: "Invoke command", method: command }
      ] : [])
    ]
  };
};
