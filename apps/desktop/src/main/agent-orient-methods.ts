import { Effect } from "effect";
import {
  buildTimeline,
  projectPanels,
  projectWindows,
  type EventStore,
  type MethodRegistry,
  type PlasticMethod,
  type TimelineInput
} from "@plastic/core";
import type {
  CapabilityRegistry,
  RuntimeMethodContext,
  RuntimeModule,
  RunPromise
} from "./runtime-method-context.js";
import { readAgentAuditStatus } from "./agent-audit-status.js";
import { readRuntimeAgentTransports, readRuntimeControlPlane, readRuntimeModules } from "./agent-runtime-modules.js";
import { readOnlyEffects, readOnlyReversibility } from "./runtime-method-metadata.js";
import { runtimeHostBaseDescriptor } from "./runtime-host-status.js";

type AgentOrientInput = {
  agentId?: string;
  panelId?: string;
  windowId?: number | string;
  eventCursor?: string;
};

type VisibleRefWindow = {
  windowId: number;
  refs: Array<{
    ref?: string;
    panel?: string;
    [key: string]: unknown;
  }>;
};

type AgentOrientHost = {
  workspaceDir: string;
  findFocusedWindowId?: (windowId?: number) => number | undefined;
  listVisibleRefs?: () => Promise<VisibleRefWindow[]>;
};

const agentOrientAvailability = {
  status: "available" as const,
  notes: "Agent orientation is a shared runtime observability primitive in headed and headless modes."
};

export const createAgentOrientModule = (host: AgentOrientHost): RuntimeModule => ({
  id: "agent-orient",
  register: async ({ capabilities, eventStore, methods, runPromise }: RuntimeMethodContext) => {
    await runPromise(
      methods.register({
        id: "agent/orient",
        title: "Orient agent",
        description: "Returns a compact local orientation packet for an embodied agent or panel.",
        owner: { kind: "runtime", id: "plastic.runtime" },
        availability: agentOrientAvailability,
        inputSchema: {
          type: "object",
          properties: {
            agentId: { type: "string", description: "Optional agent id. Defaults from panelId when present." },
            panelId: { type: "string", description: "Optional panel id to orient around." },
            windowId: { oneOf: [{ type: "number" }, { type: "string" }], description: "Optional host window id." },
            eventCursor: { type: "string", description: "Optional event id cursor for timeline context." }
          }
        },
        examples: [
          {
            title: "Orient around the main chat panel",
            input: { panelId: "chat-main" },
            verifyWith: { method: "plastic/state", input: {} }
          }
        ],
        effects: readOnlyEffects,
        reversibility: readOnlyReversibility,
        handler: (input) =>
          Effect.promise(() => buildOrientation({ capabilities, eventStore, methods, runPromise, host, input }))
      })
    );
  }
});

const buildOrientation = async (input: {
  capabilities: CapabilityRegistry;
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
  host: AgentOrientHost;
  input: unknown;
}) => {
  const context = await buildOrientationContext(input);
  const {
    binding,
    currentPanel,
    electronWindowId,
    events,
    globalTimeline,
    host,
    methodList,
    modelWindow,
    orientInput,
    panelId
  } = context;
  const agentId = orientInput?.agentId ?? (panelId ? `agent:${panelId}` : "agent:unknown");

  return {
    agent: {
      id: agentId,
      name: currentPanel?.title ? `${currentPanel.title} agent` : "Plastic agent",
      runtime: currentPanel?.kind === "chat" ? "codex" : "plastic",
      role: "embodied workspace collaborator"
    },
    embodiment: {
      panelId: panelId ?? null,
      threadId: asString(asRecord(binding).threadId) ?? null,
      windowId: modelWindow?.id ?? (electronWindowId ? `electron:${electronWindowId}` : null),
      electronWindowId: electronWindowId ?? null,
      projectDir: host.workspaceDir,
      backend: currentPanel?.kind === "chat" ? "codex" : null,
      binding
    },
    visibleContext: {
      focusedPanelId: panelId ?? currentPanel?.id ?? null,
      currentPanel: currentPanel ?? null,
      neighboringPanels: context.neighboringPanels,
      visibleRefs: context.localVisibleRefs.slice(0, 40)
    },
    memory: buildMemory(events, globalTimeline),
    capabilities: await buildCapabilities({
      capabilities: input.capabilities,
      controlPlane: readRuntimeControlPlane(events),
      agentTransports: readRuntimeAgentTransports(events),
      methods: input.methods,
      methodList,
      runPromise: input.runPromise,
      panelId,
      latestEventId: events.at(-1)?.id
    }),
    obligations: {
      orientBeforeMutation: true,
      verifyAfterMutation: true,
      durableEventsRequired: true,
      callPlasticStateBeforeGuessingIds: true
    }
  };
};

const buildOrientationContext = async (input: {
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
  host: AgentOrientHost;
  input: unknown;
}) => {
  const { eventStore, methods, runPromise, host } = input;
  const orientInput = input.input as AgentOrientInput | undefined;
  const events = await runPromise(eventStore.list());
  const panels = projectPanels(events);
  const methodList = await runPromise(methods.list());
  const panelId = orientInput?.panelId ?? orientInput?.agentId;
  const currentPanel = panelId ? panels.find((panel) => panel.id === panelId) : undefined;
  const windowContext = await buildWindowContext({ host, orientInput, panelId, events });
  const binding = await getChatBinding({
    methods,
    runPromise,
    methodList,
    ...(panelId ? { panelId } : {})
  });
  const timeline = buildOrientTimeline(events, orientInput, panelId);
  return {
    ...windowContext,
    binding,
    currentPanel,
    events,
    globalTimeline: timeline.items.length > 0
      ? timeline
      : buildTimeline(events, orientInput?.eventCursor ? { after: orientInput.eventCursor, limit: 20 } : { limit: 20 }),
    host,
    methodList,
    orientInput,
    panelId,
    ...buildPanelNeighbors(panels, currentPanel)
  };
};

const buildWindowContext = async (input: {
  host: AgentOrientHost;
  orientInput: AgentOrientInput | undefined;
  panelId: string | undefined;
  events: Parameters<typeof projectWindows>[0];
}) => {
  const { host, orientInput, panelId, events } = input;
  const windowsModel = projectWindows(events);
  const requestedWindowId = typeof orientInput?.windowId === "number" ? orientInput.windowId : undefined;
  const focusedElectronWindowId = host.findFocusedWindowId?.(requestedWindowId);
  const modelWindow = panelId
    ? windowsModel.find((window) => window.panelIds.includes(panelId))
    : windowsModel.find((window) => window.electronWindowId === focusedElectronWindowId) ?? windowsModel[0];
  const electronWindowId = requestedWindowId ?? modelWindow?.electronWindowId ?? focusedElectronWindowId;
  return {
    electronWindowId,
    modelWindow,
    localVisibleRefs: localVisibleRefs(await host.listVisibleRefs?.().catch(() => []) ?? [], electronWindowId, panelId)
  };
};

const localVisibleRefs = (windows: VisibleRefWindow[], electronWindowId: number | undefined, panelId: string | undefined) => {
  const visibleRefs = windows
    .filter((windowRefs) => electronWindowId === undefined || windowRefs.windowId === electronWindowId)
    .flatMap((windowRefs) => windowRefs.refs.map((ref) => ({ windowId: windowRefs.windowId, ...ref })));
  return panelId
    ? visibleRefs.filter((ref) => ref.panel === panelId || ref.ref?.includes(panelId))
    : visibleRefs;
};

const buildPanelNeighbors = (
  panels: ReturnType<typeof projectPanels>,
  currentPanel: ReturnType<typeof projectPanels>[number] | undefined
) => {
  const orderedPanels = [...panels].sort((left, right) => left.order - right.order);
  const currentIndex = currentPanel ? orderedPanels.findIndex((panel) => panel.id === currentPanel.id) : -1;
  return {
    neighboringPanels: currentIndex >= 0
      ? orderedPanels.slice(Math.max(0, currentIndex - 2), currentIndex + 3).filter((panel) => panel.id !== currentPanel?.id)
      : orderedPanels.slice(0, 5)
  };
};

const buildMemory = (
  events: Parameters<typeof buildTimeline>[0],
  globalTimeline: ReturnType<typeof buildTimeline>
) => ({
  latestEventId: events.at(-1)?.id ?? null,
  eventCount: events.length,
  eventCursor: events.at(-1)?.id ?? null,
  sinceCursor: globalTimeline.items,
  recentUserIntents: globalTimeline.items.filter((item) => item.type.includes("user_message")).slice(-8),
  recentAgentActions: globalTimeline.items.filter((item) =>
    item.actor.kind === "agent" ||
    item.type.startsWith("bridge.") ||
    item.type.startsWith("codex.") ||
    item.type.includes("agent_message")
  ).slice(-12)
});

const buildCapabilities = async (input: {
  capabilities: CapabilityRegistry;
  agentTransports: Array<Record<string, unknown>>;
  controlPlane: Record<string, unknown> | null;
  methods: MethodRegistry;
  methodList: PlasticMethod[];
  runPromise: RunPromise;
  panelId: string | undefined;
  latestEventId: string | undefined;
}) => ({
  hostBase: runtimeHostBaseDescriptor,
  host: {
    count: input.capabilities.list().length,
    items: input.capabilities.list()
  },
  modules: await readRuntimeModules(input),
  auditStatus: await readAgentAuditStatus(input),
  controlPlane: input.controlPlane,
  agentTransports: input.agentTransports,
  methods: recommendedMethods(input.methodList),
  recommendedActions: [
    { id: "refresh-orientation", title: "Refresh orientation", method: "agent/orient", input: { panelId: input.panelId, eventCursor: input.latestEventId } },
    { id: "read-state", title: "Read full Plastic state", method: "plastic/state" },
    { id: "read-host", title: "Read runtime host", method: "runtime/host" },
    { id: "read-audit-status", title: "Read latest runtime audit status", method: "runtime/auditStatus" },
    { id: "run-audit-action", title: "Run a current runtime audit action", method: "runtime/runAuditAction" },
    { id: "read-control-plane", title: "Read runtime control plane", method: "events/list", input: { types: ["runtime.started"], limit: 1 } },
    { id: "read-timeline", title: "Read recent timeline", method: "events/timeline", input: { after: input.latestEventId } },
    ...(input.panelId ? [{ id: "send-chat", title: "Send a message through this chat", method: "chats/sendToCodex", input: { chatId: input.panelId } }] : []),
    { id: "inspect-visible-refs", title: "Inspect visible refs", method: "deixis/listVisibleRefs" },
    { id: "capture-screenshot", title: "Capture screenshot", method: "windows/screenshot" }
  ],
  links: [
    { rel: "self", href: "agent/orient", method: "agent/orient" },
    { rel: "state", href: "plastic/state", method: "plastic/state" },
    { rel: "timeline", href: "events/timeline", method: "events/timeline" },
    { rel: "methods", href: "plastic/methods", method: "plastic/methods" },
    { rel: "host", href: "runtime/host", method: "runtime/host" },
    { rel: "audit-status", href: "runtime/auditStatus", method: "runtime/auditStatus" },
    { rel: "audit-action", href: "runtime/runAuditAction", method: "runtime/runAuditAction" },
    { rel: "modules", href: "runtime/modules", method: "runtime/modules" },
    { rel: "control-plane", href: "events/list", method: "events/list", input: { types: ["runtime.started"], limit: 1 } },
    { rel: "capabilities", href: "runtime/capabilities", method: "runtime/capabilities" },
    { rel: "visible-refs", href: "deixis/listVisibleRefs", method: "deixis/listVisibleRefs" }
  ]
});

const getChatBinding = async (input: {
  methods: MethodRegistry;
  runPromise: RunPromise;
  methodList: PlasticMethod[];
  panelId?: string;
}) => {
  const { methods, runPromise, methodList, panelId } = input;
  return panelId && methodList.some((method) => method.id === "chats/getBinding")
    ? await runPromise(methods.call("chats/getBinding", { chatId: panelId })).catch((error) => ({
      error: error instanceof Error ? error.message : String(error)
    }))
    : null;
};

const buildOrientTimeline = (
  events: Parameters<typeof buildTimeline>[0],
  orientInput: AgentOrientInput | undefined,
  panelId: string | undefined
) => {
  const timelineInput: TimelineInput = { limit: 20 };
  if (orientInput?.eventCursor) {
    timelineInput.after = orientInput.eventCursor;
  }
  if (panelId) {
    timelineInput.scope = { panelId };
  }
  return buildTimeline(events, timelineInput);
};

const recommendedMethods = (methodList: PlasticMethod[]) => {
  const recommendedMethodIds = [
    "agent/orient",
    "plastic/state",
    "events/timeline",
    "plastic/methods",
    "chats/sendToCodex",
    "chats/createCodexChat",
    "deixis/listVisibleRefs",
    "deixis/resolveRef",
    "deixis/fillRef",
    "deixis/clickRef",
    "windows/screenshot"
  ];
  return methodList
    .filter((method) => recommendedMethodIds.includes(method.id))
    .map((method) => ({
      id: method.id,
      title: method.title,
      description: method.description,
      owner: method.owner
    }));
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;
