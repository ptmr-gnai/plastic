import { Effect } from "effect";
import {
  buildTimeline,
  groupMethodsByOwner,
  projectExtensions,
  projectPanels,
  projectWindows,
  type EventStore,
  type MethodRegistry,
  type TimelineInput
} from "@plastic/core";
import type { RuntimeMethodContext, RuntimeModule, RunPromise } from "./runtime-method-context.js";

type AgentWorkbenchInput = {
  panelId?: string;
  ref?: string;
  eventCursor?: string;
  limit?: number;
};

type FlatVisibleRef = {
  windowId: number;
  ref?: string;
  panel?: string;
  extension?: string;
  command?: string;
  [key: string]: unknown;
};

type VisibleRefWindow = {
  windowId: number;
  refs: Array<{
    ref?: string;
    panel?: string;
    extension?: string;
    command?: string;
    [key: string]: unknown;
  }>;
};

type AgentWorkbenchHost = {
  mode: "electron" | "headless";
  workspaceDir: string;
  eventPath: string;
  getRuntimeStatus: () => unknown;
  getCodexStatus: () => unknown;
  readGitStatus: () => Promise<unknown>;
  getFocusedElectronWindowId?: () => number | undefined;
  listVisibleRefs?: () => Promise<VisibleRefWindow[]>;
  panelIdFromRef?: (ref: string) => string | undefined;
  sourceHintsFor?: (input: { ref?: string; panelId?: string; extensionId?: string; command?: string }) => string[];
  visualActions?: (input: { ref?: string; panelId?: string }) => Array<Record<string, unknown>>;
};

const agentWorkbenchAvailability = {
  status: "available" as const,
  notes: "Agent workbench is a shared runtime observability primitive in headed and headless modes."
};

export const createAgentWorkbenchModule = (host: AgentWorkbenchHost): RuntimeModule => ({
  id: "agent-workbench",
  register: async ({ eventStore, methods, runPromise }: RuntimeMethodContext) => {
    await runPromise(
      methods.register({
        id: "agent/workbench",
        title: "Agent workbench",
        description: "Returns a high-signal workbench packet for agents: state, refs, events, methods, git dirt, and recommended actions.",
        owner: { kind: "runtime", id: "plastic.runtime" },
        availability: agentWorkbenchAvailability,
        handler: (input) =>
          Effect.promise(() => buildWorkbench({ eventStore, methods, runPromise, host, input }))
      })
    );
  }
});

const buildWorkbench = async (input: {
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
  host: AgentWorkbenchHost;
  input: unknown;
}) => {
  const { eventStore, methods, runPromise, host } = input;
  const workbenchInput = input.input as AgentWorkbenchInput | undefined;
  const events = await runPromise(eventStore.list());
  const methodList = await runPromise(methods.list());
  const panels = projectPanels(events);
  const extensions = projectExtensions(events);
  const windowsModel = projectWindows(events, panels);
  const visibleRefs = flattenVisibleRefs(await host.listVisibleRefs?.().catch(() => []) ?? []);
  const panelId = workbenchInput?.panelId ?? (
    workbenchInput?.ref ? host.panelIdFromRef?.(workbenchInput.ref) : undefined
  );
  const panel = panelId ? panels.find((candidate) => candidate.id === panelId) : undefined;
  const extension = panel?.extensionId ? extensions.find((candidate) => candidate.id === panel.extensionId) : undefined;

  return {
    app: buildApp(host),
    focus: {
      ref: workbenchInput?.ref ?? null,
      panelId: panelId ?? null,
      panel: panel ?? null,
      extension: extension ?? null,
      window: findFocusWindow(windowsModel, panelId, host.getFocusedElectronWindowId?.())
    },
    observability: buildObservability({ host, workbenchInput, events, panelId, extensionId: extension?.id, visibleRefs }),
    control: buildControl({ host, methodList, workbenchInput, panelId, latestEventId: events.at(-1)?.id }),
    workspace: { git: await host.readGitStatus() },
    obligations: {
      orientBeforeMutation: true,
      preferRuntimeEvidence: true,
      verifyAfterMutation: true,
      keepChangesScoped: true
    }
  };
};

const flattenVisibleRefs = (windows: VisibleRefWindow[]): FlatVisibleRef[] =>
  windows.flatMap((windowRefs) =>
    windowRefs.refs.map((ref) => ({ windowId: windowRefs.windowId, ...ref }))
  );

const buildApp = (host: AgentWorkbenchHost) => ({
  mode: host.mode,
  workspaceDir: host.workspaceDir,
  eventPath: host.eventPath,
  runtime: host.getRuntimeStatus(),
  codex: host.getCodexStatus()
});

const findFocusWindow = (
  windowsModel: ReturnType<typeof projectWindows>,
  panelId: string | undefined,
  focusedElectronWindowId: number | undefined
) =>
  windowsModel.find((window) => window.electronWindowId === focusedElectronWindowId)
    ?? windowsModel.find((window) => panelId ? window.panelIds.includes(panelId) : false)
    ?? windowsModel[0]
    ?? null;

const buildObservability = (input: {
  host: AgentWorkbenchHost;
  workbenchInput: AgentWorkbenchInput | undefined;
  events: Parameters<typeof buildTimeline>[0];
  panelId: string | undefined;
  extensionId: string | undefined;
  visibleRefs: FlatVisibleRef[];
}) => {
  const { host, workbenchInput, events, panelId, extensionId, visibleRefs } = input;
  const panelRefs = panelId
    ? visibleRefs.filter((ref) => ref.panel === panelId || ref.ref?.includes(panelId))
    : visibleRefs;
  const timeline = buildWorkbenchTimeline(events, workbenchInput, panelId);
  const sourceHintInput = buildSourceHintInput(workbenchInput, panelId, extensionId, visibleRefs);
  return {
    visibleRefs: panelRefs.slice(0, 60),
    sourceHints: host.sourceHintsFor?.(sourceHintInput) ?? [],
    timeline,
    latestEventId: events.at(-1)?.id ?? null
  };
};

const buildControl = (input: {
  host: AgentWorkbenchHost;
  methodList: Parameters<typeof groupMethodsByOwner>[0];
  workbenchInput: AgentWorkbenchInput | undefined;
  panelId: string | undefined;
  latestEventId: string | undefined;
}) => {
  const { host, methodList, workbenchInput, panelId, latestEventId } = input;
  return {
    methodCount: methodList.length,
    methodGroups: groupMethodsByOwner(methodList),
    recommendedActions: [
      { id: "refresh-workbench", title: "Refresh workbench", method: "agent/workbench", input: { panelId, eventCursor: latestEventId } },
      { id: "read-state", title: "Read state", method: "plastic/state" },
      { id: "read-methods", title: "Read methods", method: "plastic/methods" },
      { id: "read-timeline", title: "Read timeline", method: host.mode === "electron" ? "events/timeline" : "events/list", input: { limit: 25, ...(panelId ? { scope: { panelId } } : {}) } },
      ...(host.visualActions?.({
        ...(workbenchInput?.ref ? { ref: workbenchInput.ref } : {}),
        ...(panelId ? { panelId } : {})
      }) ?? [])
    ]
  };
};

const buildWorkbenchTimeline = (
  events: Parameters<typeof buildTimeline>[0],
  workbenchInput: AgentWorkbenchInput | undefined,
  panelId: string | undefined
) => {
  const timelineInput: TimelineInput = {
    limit: workbenchInput?.limit ?? 25,
    ...(workbenchInput?.eventCursor ? { after: workbenchInput.eventCursor } : {}),
    ...(panelId ? { scope: { panelId } } : {})
  };
  const scopedTimeline = buildTimeline(events, timelineInput);
  return scopedTimeline.items.length > 0
    ? scopedTimeline
    : buildTimeline(events, {
      limit: workbenchInput?.limit ?? 25,
      ...(workbenchInput?.eventCursor ? { after: workbenchInput.eventCursor } : {})
    });
};

const buildSourceHintInput = (
  workbenchInput: AgentWorkbenchInput | undefined,
  panelId: string | undefined,
  extensionId: string | undefined,
  visibleRefs: FlatVisibleRef[]
) => {
  const sourceHintInput: { ref?: string; panelId?: string; extensionId?: string; command?: string } = {};
  if (workbenchInput?.ref) {
    sourceHintInput.ref = workbenchInput.ref;
    const visibleRef = visibleRefs.find((ref) => ref.ref === workbenchInput.ref);
    if (visibleRef?.command) {
      sourceHintInput.command = visibleRef.command;
    }
  }
  if (panelId) {
    sourceHintInput.panelId = panelId;
  }
  if (extensionId) {
    sourceHintInput.extensionId = extensionId;
  }
  return sourceHintInput;
};
