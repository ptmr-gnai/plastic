import { createAgentOrientModule } from "./agent-orient-methods.js";
import { createAgentWorkbenchModule } from "./agent-workbench-methods.js";
import { createDeixisMethodModule } from "./deixis-methods.js";
import { createExtensionAuthoringModule } from "./extension-authoring-methods.js";
import { createRendererControlModule } from "./renderer-control-methods.js";
import { createRuntimeBuildModule, type RuntimeCommandResult } from "./runtime-build-methods.js";
import { createRuntimeDiagnosticsModule } from "./runtime-diagnostics-methods.js";
import { createRuntimeHealthModule } from "./runtime-health-methods.js";
import { createSnapshotAppDetails, decorateRuntimeState } from "./runtime-host-status.js";
import type { createRuntimeHostConfig } from "./runtime-host-config.js";
import { createRuntimeHostModule } from "./runtime-host-methods.js";
import type { RuntimeModulePlanInput } from "./runtime-module-plan.js";
import { createRuntimeSnapshotModule } from "./runtime-snapshot-methods.js";
import { createRuntimeStateModule } from "./runtime-state-methods.js";
import { createWindowCapabilityModule } from "./window-capability-methods.js";

type RuntimeHostConfig = ReturnType<typeof createRuntimeHostConfig>;
type RuntimeMode = "electron" | "headless";
type RuntimeHostProjectionInput = Parameters<typeof createRuntimeHostProjectionModules>[0];
type RuntimeHostAgentInput = Parameters<typeof createRuntimeHostAgentModules>[0];
type RuntimeHostCapabilityInput = NonNullable<Parameters<typeof createRuntimeHostCapabilityModules>[0]>;
type RuntimeHostSupportInput = Parameters<typeof createRuntimeHostSupportBundle>[0];
type HeadlessRuntimeHostStandardInput = {
  config: RuntimeHostConfig;
  workspaceDir: string;
  eventPath: string;
  plasticDir: string;
  getBuildStatus: () => unknown;
  getHost: () => Record<string, unknown>;
  runCommand: RuntimeHostSupportInput["runCommand"];
  getDiagnostics: RuntimeHostSupportInput["getDiagnostics"];
  readGitStatus: RuntimeHostAgentInput["workbench"]["readGitStatus"];
  callCodexStatus: () => Promise<unknown>;
};
type ElectronRuntimeHostStandardInput = {
  config: RuntimeHostConfig;
  workspaceDir: string;
  eventPath: string;
  plasticDir: string;
  getBuildStatus: () => unknown;
  getHost: () => Record<string, unknown>;
  runCommand: RuntimeHostSupportInput["runCommand"];
  getDiagnostics: RuntimeHostSupportInput["getDiagnostics"];
  readGitStatus: RuntimeHostAgentInput["workbench"]["readGitStatus"];
  getAppVersion: () => string;
  isAppReady: () => boolean;
  getWindowCount: () => number;
  getRetainedWindowCount: () => number;
  getCodexStatus: () => unknown;
  callBridgeStatus: () => Promise<unknown>;
  findFocusedWindowId: NonNullable<RuntimeHostAgentInput["orient"]["findFocusedWindowId"]>;
  listVisibleRefs: NonNullable<RuntimeHostAgentInput["workbench"]["listVisibleRefs"]>;
  panelIdFromRef: NonNullable<RuntimeHostAgentInput["workbench"]["panelIdFromRef"]>;
  sourceHintsFor: NonNullable<RuntimeHostAgentInput["workbench"]["sourceHintsFor"]>;
  reloadRenderers: NonNullable<NonNullable<RuntimeHostCapabilityInput["rendererControl"]>["reloadRenderers"]>;
  browserWindow: NonNullable<NonNullable<RuntimeHostCapabilityInput["windowCapability"]>["browserWindow"]>;
  createWindow: NonNullable<NonNullable<RuntimeHostCapabilityInput["windowCapability"]>["createWindow"]>;
  scrollRefIntoViewScript: NonNullable<NonNullable<RuntimeHostCapabilityInput["windowCapability"]>["scrollRefIntoViewScript"]>;
  deixis: NonNullable<RuntimeHostCapabilityInput["deixis"]>;
  agentBackend: NonNullable<RuntimeModulePlanInput["agentBackend"]>;
};

const unavailableCodexStatus = () => ({
  connected: false,
  initialized: false,
  pid: null,
  pendingRequests: 0
});

export const createRuntimeHostProjectionResource = (input: {
  config: RuntimeHostConfig;
  mode: RuntimeMode;
  state?: unknown;
}) => {
  const runtimeRpcUrl = input.config.preferredRuntimeRpcUrl;
  const bus = {
    runtimeRpcUrl,
    runtimeRpcUrls: input.config.runtimeRpcUrls,
    runtimeHost: input.config.controlPlane.runtime.host,
    runtimePort: input.config.runtimePort
  };
  return {
    bus,
    resource: {
      id: input.mode === "headless" ? "headless-runtime" : "rpc-bus",
      title: input.mode === "headless" ? "Plastic Headless Runtime" : "Plastic RPC Bus",
      state: input.state ?? bus,
      rpcUrl: runtimeRpcUrl
    }
  };
};

export const createRuntimeHostProjectionModules = (input: {
  config: RuntimeHostConfig;
  mode: RuntimeMode;
  bus: Record<string, unknown>;
  resource: {
    id: string;
    title: string;
    state: unknown;
    rpcUrl: string;
  };
  getHostDetails: () => Promise<{
    app?: Record<string, unknown>;
    build: unknown;
    runtime: unknown;
    codex: unknown;
    visibleRefs: unknown;
  }> | {
    app?: Record<string, unknown>;
    build: unknown;
    runtime: unknown;
    codex: unknown;
    visibleRefs: unknown;
  };
}) => ({
  state: createRuntimeStateModule({
    decorateState: (state) => decorateRuntimeState({
      state,
      mode: input.mode,
      bus: input.bus,
      resource: input.resource
    })
  }),
  snapshot: createRuntimeSnapshotModule({
    getHostDetails: async () => {
      const details = await input.getHostDetails();
      const app = createSnapshotAppDetails({ config: input.config, mode: input.mode });
      return {
        ...details,
        app: { ...app, ...details.app }
      };
    }
  })
});

export const createRuntimeHostAgentModules = (input: {
  workbench: Parameters<typeof createAgentWorkbenchModule>[0];
  orient: Parameters<typeof createAgentOrientModule>[0];
}) => ({
  agentWorkbench: createAgentWorkbenchModule(input.workbench),
  agentOrient: createAgentOrientModule(input.orient)
});

export const createRuntimeHostCapabilityModules = (input: {
  rendererControl?: Parameters<typeof createRendererControlModule>[0];
  windowCapability?: Parameters<typeof createWindowCapabilityModule>[0];
  deixis?: Parameters<typeof createDeixisMethodModule>[0];
} = {}) => ({
  rendererControl: createRendererControlModule(input.rendererControl ?? {}),
  windowCapability: createWindowCapabilityModule(input.windowCapability ?? {}),
  deixis: createDeixisMethodModule(input.deixis ?? {})
});

export const createRuntimeHostSupportModules = (input: {
  plasticDir: string;
  getBuildStatus: () => unknown;
  getHost: () => Record<string, unknown>;
  runCommand: (command: string, args: string[]) => Promise<RuntimeCommandResult>;
  getDiagnostics: () => unknown;
}) => ({
  host: createRuntimeHostModule({
    getHost: input.getHost,
    getDiagnostics: input.getDiagnostics
  }),
  build: createRuntimeBuildModule({
    getStatus: input.getBuildStatus,
    runCommand: input.runCommand
  }),
  diagnostics: createRuntimeDiagnosticsModule({
    getDiagnostics: input.getDiagnostics
  }),
  extensionAuthoring: createExtensionAuthoringModule({ plasticDir: input.plasticDir })
});

export const createRuntimeHostSupportBundle = (input: Parameters<typeof createRuntimeHostSupportModules>[0] & {
  healthChecks?: NonNullable<Parameters<typeof createRuntimeHealthModule>[0]>["hostChecks"];
}) => ({
  support: createRuntimeHostSupportModules(input),
  health: createRuntimeHealthModule({ hostChecks: input.healthChecks ?? [] })
});

export const createRuntimeHostStartupModules = (input: {
  projection: ReturnType<typeof createRuntimeHostProjectionModules>;
  agent: ReturnType<typeof createRuntimeHostAgentModules>;
  support: ReturnType<typeof createRuntimeHostSupportModules>;
  capability: ReturnType<typeof createRuntimeHostCapabilityModules>;
  agentBackend?: RuntimeModulePlanInput["agentBackend"];
  health: NonNullable<RuntimeModulePlanInput["health"]>;
}): RuntimeModulePlanInput => ({
  state: input.projection.state,
  snapshot: input.projection.snapshot,
  agentWorkbench: input.agent.agentWorkbench,
  agentOrient: input.agent.agentOrient,
  build: input.support.build,
  diagnostics: input.support.diagnostics,
  extensionAuthoring: input.support.extensionAuthoring,
  rendererControl: input.capability.rendererControl,
  windowCapability: input.capability.windowCapability,
  deixis: input.capability.deixis,
  ...(input.agentBackend !== undefined ? { agentBackend: input.agentBackend } : {}),
  health: input.health,
  tailModules: [input.support.host]
});

export const createRuntimeHostStandardModules = (input: {
  config: RuntimeHostConfig;
  mode: RuntimeMode;
  projectionState?: unknown;
  getHostDetails: RuntimeHostProjectionInput["getHostDetails"];
  agent: RuntimeHostAgentInput;
  support: RuntimeHostSupportInput;
  capability?: RuntimeHostCapabilityInput;
  agentBackend?: RuntimeModulePlanInput["agentBackend"];
}) => {
  const projectionResource = createRuntimeHostProjectionResource({
    config: input.config,
    mode: input.mode,
    state: input.projectionState
  });
  const projection = createRuntimeHostProjectionModules({
    config: input.config,
    mode: input.mode,
    ...projectionResource,
    getHostDetails: input.getHostDetails
  });
  const agent = createRuntimeHostAgentModules(input.agent);
  const support = createRuntimeHostSupportBundle(input.support);
  const capability = createRuntimeHostCapabilityModules(input.capability);
  return createRuntimeHostStartupModules({
    projection,
    agent,
    support: support.support,
    capability,
    ...(input.agentBackend !== undefined ? { agentBackend: input.agentBackend } : {}),
    health: support.health
  });
};

export const createHeadlessRuntimeHostStandardModules = (input: HeadlessRuntimeHostStandardInput) =>
  createRuntimeHostStandardModules({
    config: input.config,
    mode: "headless",
    projectionState: input.getBuildStatus(),
    getHostDetails: () => ({
      build: input.getBuildStatus(),
      runtime: { windowCount: 0 },
      codex: unavailableCodexStatus(),
      visibleRefs: []
    }),
    agent: {
      workbench: {
        mode: "headless",
        workspaceDir: input.workspaceDir,
        eventPath: input.eventPath,
        getRuntimeStatus: input.getBuildStatus,
        getCodexStatus: unavailableCodexStatus,
        readGitStatus: input.readGitStatus
      },
      orient: { workspaceDir: input.workspaceDir }
    },
    support: {
      plasticDir: input.plasticDir,
      getBuildStatus: input.getBuildStatus,
      getHost: input.getHost,
      runCommand: input.runCommand,
      getDiagnostics: input.getDiagnostics,
      healthChecks: [
        { id: "build:status", run: input.getBuildStatus },
        { id: "diagnostics:status", run: input.getDiagnostics },
        { id: "agent-backend:fallback", run: input.callCodexStatus }
      ]
    }
  });

export const createElectronRuntimeHostStandardModules = (input: ElectronRuntimeHostStandardInput) =>
  createRuntimeHostStandardModules({
    config: input.config,
    mode: "electron",
    getHostDetails: async () => ({
      app: { version: input.getAppVersion(), ready: input.isAppReady() },
      build: input.getBuildStatus(),
      runtime: {
        windowCount: input.getWindowCount(),
        retainedWindowCount: input.getRetainedWindowCount(),
        eventStream: "runtime-http-transport"
      },
      codex: input.getCodexStatus(),
      visibleRefs: await input.listVisibleRefs()
    }),
    agent: {
      workbench: {
        mode: "electron",
        workspaceDir: input.workspaceDir,
        eventPath: input.eventPath,
        getRuntimeStatus: input.getBuildStatus,
        getCodexStatus: input.getCodexStatus,
        readGitStatus: input.readGitStatus,
        getFocusedElectronWindowId: () => input.findFocusedWindowId?.(),
        listVisibleRefs: input.listVisibleRefs,
        panelIdFromRef: input.panelIdFromRef,
        sourceHintsFor: input.sourceHintsFor,
        visualActions: ({ ref, panelId }) => [
          { id: "list-refs", title: "List visible refs", method: "deixis/listVisibleRefs" },
          { id: "screenshot", title: "Capture screenshot", method: "windows/screenshot", input: ref ? { ref } : {} },
          ...(panelId ? [{ id: "focus-panel", title: "Focus panel", method: "windows/focusPanel", input: { panelId } }] : [])
        ]
      },
      orient: {
        workspaceDir: input.workspaceDir,
        findFocusedWindowId: input.findFocusedWindowId,
        listVisibleRefs: input.listVisibleRefs
      }
    },
    support: {
      plasticDir: input.plasticDir,
      getBuildStatus: input.getBuildStatus,
      getHost: input.getHost,
      runCommand: input.runCommand,
      getDiagnostics: input.getDiagnostics,
      healthChecks: [
        { id: "deixis:listVisibleRefs", run: async () => ({ windows: (await input.listVisibleRefs()).length }) },
        { id: "build:status", run: input.getBuildStatus },
        { id: "codex:status", run: input.getCodexStatus },
        { id: "bridge:status", run: input.callBridgeStatus }
      ]
    },
    capability: {
      rendererControl: {
        reloadRenderers: input.reloadRenderers
      },
      windowCapability: {
        browserWindow: input.browserWindow,
        createWindow: input.createWindow,
        scrollRefIntoViewScript: input.scrollRefIntoViewScript
      },
      deixis: input.deixis
    },
    agentBackend: input.agentBackend
  });
