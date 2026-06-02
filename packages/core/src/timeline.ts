import type { PlasticEvent } from "./events.js";

export type EventScopeInput = {
  panelId?: string;
  agentId?: string;
  extensionId?: string;
  windowId?: string;
};

export type TimelineInput = {
  after?: string;
  before?: string;
  limit?: number;
  scope?: EventScopeInput;
  includeRaw?: boolean;
  includeDeltas?: boolean;
};

export type EventListInput = {
  after?: string;
  before?: string;
  limit?: number | "all";
  scope?: EventScopeInput;
  types?: string[];
  includeDeltas?: boolean;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export const isNoisyEvent = (event: PlasticEvent) =>
  event.type.endsWith(".delta") || event.type.includes("_delta");

export const eventSummary = (event: PlasticEvent) => {
  const payload = asRecord(event.payload);
  const scope = event.scope ?? { workspaceId: "default" };
  switch (event.type) {
    case "panel.created":
      return `Created ${asString(payload.kind) ?? "panel"} panel ${asString(payload.title) ?? asString(payload.id) ?? scope.panelId ?? "unknown"}.`;
    case "panel.removed":
      return `Removed panel ${asString(payload.id) ?? scope.panelId ?? "unknown"}.`;
    case "chat.user_message.submitted":
      return `User sent a message to ${asString(payload.chatId) ?? scope.panelId ?? "a chat panel"}.`;
    case "chat.user_message.injected":
      return `Injected a user message into ${asString(payload.chatId) ?? scope.panelId ?? "a chat panel"}.`;
    case "chat.agent_message.completed":
      return `Agent completed a message in ${asString(payload.chatId) ?? scope.panelId ?? "a chat panel"}.`;
    case "chat.codex_thread.bound":
      return `Bound ${asString(payload.chatId) ?? scope.panelId ?? "a chat panel"} to Codex thread ${asString(payload.threadId) ?? "unknown"}.`;
    case "bridge.plastic_rpc.requested":
      return `Requested Plastic RPC method ${asString(payload.method) ?? "unknown"} through the agent bridge.`;
    case "bridge.plastic_rpc.completed":
      return `Completed Plastic RPC method ${asString(payload.method) ?? "unknown"} through the agent bridge with ok=${String(payload.ok)}.`;
    case "bridge.plastic_rpc_tool.called":
      return `Codex app-server called plastic_rpc for ${asString(payload.method) ?? "unknown"}.`;
    case "extension.scaffolded":
      return `Scaffolded extension ${asString(payload.id) ?? scope.extensionId ?? "unknown"}.`;
    case "extension.discovered":
      return `Discovered extension ${asString(payload.title) ?? asString(payload.id) ?? scope.extensionId ?? "unknown"}.`;
    case "build.typecheck.completed":
      return `Typecheck completed with ok=${String(payload.ok)}.`;
    case "plastic.self_test.completed":
      return `Plastic self-test completed with ok=${String(payload.ok)}.`;
    default:
      return `${event.type} by ${event.actor.name ?? event.actor.id}.`;
  }
};

export const eventMatchesScope = (event: PlasticEvent, scope?: EventScopeInput) => {
  if (!scope) {
    return true;
  }
  if (scope.panelId && event.scope.panelId !== scope.panelId) {
    return false;
  }
  if (scope.agentId && event.scope.agentId !== scope.agentId) {
    return false;
  }
  if (scope.extensionId && event.scope.extensionId !== scope.extensionId) {
    return false;
  }
  if (scope.windowId && event.scope.windowId !== scope.windowId) {
    return false;
  }
  return true;
};

export const buildTimeline = (events: PlasticEvent[], input: TimelineInput = {}) => {
  const afterIndex = input.after ? events.findIndex((event) => event.id === input.after) : -1;
  const beforeIndex = input.before ? events.findIndex((event) => event.id === input.before) : events.length;
  const start = afterIndex >= 0 ? afterIndex + 1 : 0;
  const end = beforeIndex >= 0 ? beforeIndex : events.length;
  const limit = Math.max(1, Math.min(input.limit ?? 25, 200));
  const filtered = events
    .slice(start, end)
    .filter((event) => eventMatchesScope(event, input.scope))
    .filter((event) => input.includeDeltas || !isNoisyEvent(event))
    .slice(-limit);

  return {
    latestEventId: events.at(-1)?.id ?? null,
    eventCount: events.length,
    cursor: events.at(-1)?.id ?? null,
    items: filtered.map((event) => ({
      eventId: event.id,
      timestamp: event.timestamp,
      actor: event.actor,
      scope: event.scope,
      type: event.type,
      summary: eventSummary(event),
      causes: event.causationId ? [event.causationId] : [],
      effects: [],
      links: event.meta.links ?? [],
      ...(input.includeRaw ? { raw: event } : {})
    }))
  };
};

export const selectEvents = (events: PlasticEvent[], input: EventListInput = {}) => {
  const afterIndex = input.after ? events.findIndex((event) => event.id === input.after) : -1;
  const beforeIndex = input.before ? events.findIndex((event) => event.id === input.before) : events.length;
  const start = afterIndex >= 0 ? afterIndex + 1 : 0;
  const end = beforeIndex >= 0 ? beforeIndex : events.length;
  const typeSet = input.types ? new Set(input.types) : null;
  const selected = events
    .slice(start, end)
    .filter((event) => eventMatchesScope(event, input.scope))
    .filter((event) => !typeSet || typeSet.has(event.type))
    .filter((event) => input.includeDeltas || !isNoisyEvent(event));

  if (input.limit === "all") {
    return selected;
  }

  const limit = Math.max(1, Math.min(input.limit ?? 500, 5_000));
  return selected.slice(-limit);
};
