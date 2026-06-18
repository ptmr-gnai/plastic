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

const sourceHintInputFor = (input: { ref: string; panelId?: string | undefined; extensionId?: string | undefined; command?: string | undefined }) => ({
  ref: input.ref,
  ...(input.panelId ? { panelId: input.panelId } : {}),
  ...(input.extensionId ? { extensionId: input.extensionId } : {}),
  ...(input.command ? { command: input.command } : {})
});

const elementProjection = (ref: string, visible: Awaited<ReturnType<DeixisMethodHost["resolveVisibleRef"]>>) => visible ? {
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
} : null;

const resourceLinksFor = (input: { panelId?: string | undefined; extensionId?: string | undefined }) => [
  ...(input.panelId ? [{ rel: "panel", href: "panels/get", method: "panels/get", target: input.panelId, input: { id: input.panelId } }] : []),
  ...(input.extensionId ? [{ rel: "extension", href: "extensions/get", method: "extensions/get", target: input.extensionId, input: { id: input.extensionId } }] : []),
  ...(input.panelId ? [{ rel: "timeline", href: "events/timeline", method: "events/timeline", target: input.panelId, input: { scope: { panelId: input.panelId }, limit: 12 } }] : [])
];

const verificationFor = (input: { ref: string; panelId?: string | undefined }) => [
  ...(input.panelId ? [
    { id: "verify-ref-action", title: "Verify ref action", method: "deixis/verifyRefAction", input: { ref: input.ref, panelId: input.panelId, limit: 30 } },
    { id: "timeline-after-action", title: "Verify panel timeline", method: "events/timeline", input: { scope: { panelId: input.panelId }, limit: 12 } }
  ] : []),
  { id: "visible-after-action", title: "Verify visible refs", method: "deixis/listVisibleRefs" },
  { id: "screenshot-after-action", title: "Verify screenshot", method: "windows/screenshot", input: { ref: input.ref } }
];

const actionsFor = (input: {
  ref: string;
  panelId?: string | undefined;
  extensionId?: string | undefined;
  command?: string | undefined;
  isChatCompose: boolean;
}) => [
  ...(input.panelId ? [
    { id: "get-panel", title: "Get panel", method: "panels/get", input: { id: input.panelId } },
    { id: "rename-panel", title: "Rename panel", method: "panels/rename", input: { id: input.panelId } },
    { id: "move-panel", title: "Move panel", method: "panels/move", input: { id: input.panelId } },
    { id: "remove-panel", title: "Remove panel", method: "panels/remove", input: { id: input.panelId } }
  ] : []),
  ...(input.isChatCompose && input.panelId ? [
    { id: "fill-compose", title: "Fill chat compose", method: "deixis/fillRef", input: { ref: input.ref, value: "" } },
    { id: "send-compose", title: "Submit chat compose", method: "deixis/clickRef", input: { ref: input.ref } },
    { id: "send-chat-direct", title: "Send chat message directly", method: "chats/sendToCodex", input: { chatId: input.panelId, content: "" } }
  ] : []),
  ...(input.extensionId ? [
    { id: "get-extension", title: "Get extension", method: "extensions/get", input: { id: input.extensionId } }
  ] : []),
  ...(input.command ? [
    { id: "invoke-command", title: "Invoke command", method: input.command }
  ] : [])
];

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

  return {
    ref,
    element: elementProjection(ref, visible),
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
      resourceLinks: resourceLinksFor({ panelId, extensionId })
    },
    panel,
    extension,
    command,
    sourceHints: host.sourceHintsFor(sourceHintInputFor({ ref, panelId, extensionId, command })),
    lineage,
    verification: verificationFor({ ref, panelId }),
    actions: actionsFor({ ref, panelId, extensionId, command, isChatCompose })
  };
};
