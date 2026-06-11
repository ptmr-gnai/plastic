# Unified Runtime And Client Spec

## Purpose

This proposal addresses the current headed/headless bifurcation risk in Plastic.

Plastic should not have one implementation for Electron and another implementation for headless operation. It should have one workspace runtime kernel with multiple clients and host capability providers.

The desired shape:

```text
workspace event store + runtime services + method registry
  <- transports: HTTP, Electron IPC, MCP, future sockets
  <- clients: Electron renderer, panels, agents, CLI scripts, external tools
  <- host capabilities: Electron windows/DOM/screenshots, headless process, build runner
```

The Electron app and headless mode should differ only by the host capabilities they attach and the clients they launch. A method, extension, or agent-facing primitive should be built once and then work in both places whenever its required capabilities are available.

## Current State

Plastic already has several of the right primitives:

- `@plastic/core` owns events, projections, the method registry, and shared state builders.
- Both Electron and headless create a local event store.
- Both create a `MethodRegistry`.
- Both expose `POST /rpc`.
- Both register extension methods and activate extensions.
- Both expose event-derived projections such as panels, extensions, windows, and app state.
- The GUI renderer is increasingly a projection/client over state rather than the owner of state.

The bifurcation is in runtime assembly:

- `apps/desktop/src/main/main.ts` is the Electron host. It creates the event store, method registry, HTTP runtime bus, Electron IPC bridge, build bus, Electron window capabilities, Codex adapter, extension loading, and many runtime methods.
- `apps/desktop/src/main/headless.ts` is a second host. It creates its own event store, method registry, HTTP runtime bus, SSE stream, extension loading, and its own copy or stub of several runtime methods.
- Some method behavior and metadata exist in both files. That makes drift likely.
- Some Electron methods have no headless equivalent because they depend on window/DOM capabilities.
- Some headless methods are stubs because the matching backend, such as Codex app-server integration, is Electron-hosted today.

So the current system is not "Electron client plus headless client." It is closer to "two runtime hosts that share some core libraries and an RPC shape."

That is useful for learning, but it is not the final architecture.

## Target Model

Plastic should have one host-agnostic runtime kernel:

```ts
interface PlasticRuntime {
  workspaceDir: string;
  eventStore: EventStore;
  methods: MethodRegistry;
  capabilities: CapabilityRegistry;
  eventBus: EventBus;
  start(): Effect.Effect<void>;
  stop(): Effect.Effect<void>;
}
```

Runtime construction should be shared:

```ts
const runtime = await createPlasticRuntime({
  workspaceDir,
  eventStore,
  capabilities,
  transports,
  modules
});
```

Electron and headless become small bootstraps:

```ts
// Electron
createPlasticRuntime({
  capabilities: electronCapabilities,
  transports: [httpRpcTransport, electronIpcTransport, mcpTransport],
  modules: defaultRuntimeModules
});

// Headless
createPlasticRuntime({
  capabilities: headlessCapabilities,
  transports: [httpRpcTransport, mcpTransport],
  modules: defaultRuntimeModules
});
```

The same runtime modules register the same methods in both modes.

## Layer Boundaries

### 1. Core Data Layer

Lives in `packages/core`.

Owns:

- event types and event store contracts;
- read models and projections;
- method registry types;
- HATEOAS resource/action/link types;
- pure helpers for timeline, panels, chats, extensions, windows, and state.

Must not depend on Electron, Node host behavior, DOM APIs, or specific clients.

### 2. Runtime Kernel

Lives above core and below hosts.

Owns:

- runtime lifecycle;
- event append helpers;
- method registration;
- extension discovery, activation, reload, and recovery;
- agent/backend adapters through capability interfaces;
- event stream fanout;
- common observability methods;
- common control methods.

This is the layer that should make headless and headed feel like the same app.

### 3. Capability Providers

Host-specific behavior is exposed as typed optional capabilities.

Examples:

```ts
interface WindowCapability {
  listWindows(): Effect.Effect<PlasticWindow[]>;
  createWindow(input: unknown): Effect.Effect<PlasticWindow>;
  focusPanel(input: { panelId: string }): Effect.Effect<void>;
}

interface DomCapability {
  listVisibleRefs(): Effect.Effect<VisibleRef[]>;
  resolveRef(input: { ref: string }): Effect.Effect<ResolvedRef>;
  clickRef(input: { ref: string }): Effect.Effect<void>;
  fillRef(input: { ref: string; value: string }): Effect.Effect<void>;
  evalDom(input: { script: string }): Effect.Effect<unknown>;
}

interface ScreenshotCapability {
  capture(input: { windowId?: number; ref?: string }): Effect.Effect<ScreenshotResult>;
}
```

Electron provides real implementations for windows, DOM, and screenshots.

Headless provides either:

- absent capabilities with explicit capability status; or
- simulated/projection-only implementations where meaningful.

The method registry should expose this truth through metadata. A method should teach an agent whether it is available, unavailable, degraded, or projection-only in the current host.

### 4. Transports

Transports are adapters. They do not own app behavior.

Required transports:

- HTTP RPC: external local agents and scripts.
- Electron IPC: renderer process calls.
- MCP/native bridge: Codex agents when local TCP is unavailable.
- Event stream transport: renderer, agents, and external observers.

Every transport calls the same `MethodRegistry`.

### 5. Clients

Clients are projections/controllers over the runtime.

Clients include:

- Electron renderer windows;
- extension panels;
- chat agents;
- external Codex/Codex-like agents;
- CLI smoke-test scripts;
- future browser or web clients.

Clients do not mutate durable app state directly. They call RPC methods, subscribe to state/events, and render projections.

## Method Availability Contract

Plastic should prefer stable method identity across host modes.

For example, `windows/screenshot` should not silently disappear in headless. It should either:

- be registered and report `availability: "unavailable"` because no screenshot capability exists; or
- return a typed unavailable error with method metadata explaining the missing capability.

This is better for agents than a missing method, because it lets an agent understand the shape of the environment and choose another verification path.

Proposed metadata extension:

```ts
type MethodAvailability = {
  status: "available" | "degraded" | "unavailable";
  requiredCapabilities?: string[];
  missingCapabilities?: string[];
  notes?: string;
};
```

Every method exposed through `plastic/methods` and `methods/describe` should eventually include availability.

## Invariants

1. One workspace has one durable Plastic event stream.

2. One runtime instance has one method registry.

3. HTTP, Electron IPC, MCP, and internal calls all route to the same method registry.

4. A runtime method is implemented once unless it is explicitly a host capability adapter.

5. Electron and headless boot the same runtime modules.

6. Host-specific APIs are capabilities, not alternate app implementations.

7. GUI state changes happen through RPC methods and durable events.

8. Headless can run every non-visual runtime, extension, event, method, and build validation path.

9. Headed validation adds DOM, screenshot, focus, and visual proof on top of the same runtime proof.

10. `plastic/state`, `plastic/methods`, and `methods/describe` reveal the actual capability status of the current host.

11. Extensions register methods and panels through the same runtime APIs in both modes.

12. If a method mutates meaningful state, it appends durable events regardless of the calling transport.

## What "Build Once" Means

A new Plastic feature should usually be one or more runtime modules:

```ts
interface RuntimeModule {
  id: string;
  register(ctx: RuntimeContext): Effect.Effect<void>;
}

interface RuntimeContext {
  eventStore: EventStore;
  methods: MethodRegistry;
  capabilities: CapabilityRegistry;
  appendEvent(input: EventInput): Effect.Effect<PlasticEvent>;
  publish(event: PlasticEvent): Effect.Effect<void>;
}
```

If the feature has no visual requirement, it should work unchanged in headless and Electron.

If the feature has visual behavior, it should split into:

- a runtime method/event/read-model contract that works everywhere;
- an optional renderer/client projection that only appears in headed clients;
- optional DOM/screenshot/deixis methods that declare their host capability requirements.

Examples:

- `panels/create` should be one shared runtime method.
- `panels/list` should be one shared projection method.
- `windows/screenshot` should be one shared method whose handler delegates to `ScreenshotCapability`.
- `chats/sendToCodex` should be one shared method whose handler delegates to an agent backend capability.
- `deixis/listVisibleRefs` should be one shared method whose output is real in Electron and empty/unavailable in pure headless.

## Recommended Architecture

### Runtime Modules

Extract method registration into focused modules:

- `stateRuntimeModule`
- `eventRuntimeModule`
- `panelControlRuntimeModule`
- `windowRuntimeModule`
- `extensionRuntimeModule`
- `agentWorkbenchRuntimeModule`
- `chatRuntimeModule`
- `settingsRuntimeModule`
- `deixisRuntimeModule`
- `buildRuntimeModule`
- `codexRuntimeModule`

Each module receives `RuntimeContext` and registers methods exactly once.

### Host Bootstraps

Electron bootstrap should only:

- create Electron windows;
- provide Electron capabilities;
- start shared runtime;
- attach Electron IPC transport;
- attach HTTP/build transports;
- launch renderer clients.

Headless bootstrap should only:

- provide headless capabilities;
- start shared runtime;
- attach HTTP/MCP transports;
- optionally run CLI commands or smoke tests.

### Renderer

The renderer should be treated as a client:

- call `window.plastic.rpc`;
- subscribe to state/events;
- render projections;
- expose visible refs;
- avoid owning hidden durable state.

This aligns with the existing goal that the GUI is a projection of state.

## Migration Plan

This should be done in thin vertical slices, not a big-bang rewrite.

### Slice 1: Shared Runtime Context

Create `createPlasticRuntime` and `RuntimeContext`.

Move shared construction into it:

- event store;
- method registry;
- append-and-broadcast helper;
- extension discovery/activation wiring;
- runtime module registration loop.

Electron and headless should still behave the same after this slice.

Validation:

- `pnpm typecheck`
- start headless and call `plastic/state`
- start Electron and call `plastic/state`
- compare core resources and method counts

### Slice 2: Extract Shared Method Modules

Move duplicated methods out of `main.ts` and `headless.ts`.

Start with low-risk modules:

- panels;
- events;
- app settings/theme;
- methods discovery.

Validation:

- same RPC script runs against headless and Electron;
- create, get, rename, move, remove a panel in both modes;
- verify events and projections match.

### Slice 3: Capability Registry

Add capability registration and method availability metadata.

Move Electron-only behavior behind capabilities:

- DOM refs;
- screenshots;
- window focus;
- Electron-specific window creation;
- Codex app-server if it remains Electron-hosted.

Validation:

- `methods/describe` reports capability requirements;
- headless exposes unavailable/degraded methods legibly;
- Electron exposes available visual methods;
- agents can choose correct verification paths.

### Slice 4: One RPC Transport Package

Extract HTTP RPC and event-stream server into a reusable transport module.

Both hosts should call the same transport code.

Validation:

- same HTTP behavior in Electron and headless;
- same error envelope;
- same CORS/options behavior;
- same event-stream behavior.

### Slice 5: Differential Contract Tests

Add a single test harness that accepts a runtime URL:

```text
PLASTIC_RPC_URL=http://127.0.0.1:7331/rpc pnpm plastic:contract
```

The same script should validate:

- `plastic/state`
- `plastic/methods`
- `methods/describe`
- panel lifecycle
- extension scan/list
- event list/timeline
- self-test

Run it against both headless and Electron.

## Acceptance Criteria

The unified architecture is working when:

- adding a non-visual RPC method requires no Electron/headless duplication;
- adding a capability-backed method requires one shared method plus one or more host capability providers;
- `plastic/methods` has the same stable method ids in both modes, except intentionally omitted experimental methods;
- `methods/describe` explains which methods are unavailable or degraded in headless;
- the same contract script can drive both modes;
- a generated extension can be scanned, registered, called, and projected in headless, then visually verified in Electron without changing the extension;
- the renderer has no private durable mutation path outside RPC/event methods.

## Open Design Choices

### Register Unavailable Methods Or Hide Them

Recommendation: register them with availability metadata.

Agents learn faster when the environment says "I know what screenshots are, but this host has no screenshot capability" rather than leaving the method absent.

### One Long-Lived Runtime Or Per-Client Runtime

Recommendation: one runtime per workspace process.

Multiple clients should attach to it. Multiple windows should not create separate method registries or event stores.

### Headless As CLI Or Server

Recommendation: headless is a server/runtime host. CLI commands are clients of that host.

This keeps the contract clean:

```text
headless runtime exposes RPC
CLI script calls RPC
Electron renderer calls RPC/IPC
agents call RPC/MCP
```

The CLI should not become a separate implementation of Plastic behavior.

## Implementation Status

The first unification pass is substantially complete:

- `createPlasticRuntime` creates the shared event store, method registry, capability registry, append helper, and module registration path.
- `createRuntimeHostBase` creates shared host config/status, workspace command helpers, git status, runtime construction, and durable `runtime.started` base payload.
- `createRuntimeHostProjectionResource` creates the shared bus/resource descriptor used by state and snapshot projections in both hosts.
- `createRuntimeHostSupportBundle` creates shared host, build, diagnostics, extension-authoring, and health modules while preserving host-specific health checks.
- `createRuntimeHostStandardModules` assembles projection, agent, capability, support, health, and startup module plans for both Electron and headless hosts.
- `createHeadlessRuntimeHostStandardModules` keeps headless unavailable-Codex, no-window, and no-visible-ref policy out of the entrypoint.
- Electron and headless both use shared runtime modules for state, snapshot, agent workbench/orientation, build, diagnostics, extension authoring/runtime, renderer/window/deixis capability-backed methods, runtime control, panel control, panel mailbox, runtime modules, and health.
- The runtime/build HTTP transports share request helpers, RPC dispatch, method GET dispatch, `/host`, `/state`, `/methods`, `/capabilities`, `/snapshot`, SSE event streams, CORS behavior, and error envelopes.
- `runtime/host`, `runtime/capabilities`, `methods/describe`, `runtime/modules`, `agent/workbench`, `agent/orient`, `plastic/state`, and `plastic/snapshot` expose enough host/capability metadata for agents to learn which methods are available, degraded, or unavailable.
- `runtime.started` durably records the shared host descriptor, capability inventory, module inventory, and control plane, so agents can compare live runtime state with the event log.
- The shared contract harness validates headless end to end, including state, methods, snapshot, capabilities, modules, panel lifecycle, extension scan/list, event streams, HTTP error contracts, build HTTP surfaces, and self-test.
- `pnpm plastic:method-parity` runs `plastic/selfTest` in both hosts and verifies shared runtime health checks are green while permitting host-specific checks to differ.

The previous validation blocker was below Plastic code: Electron could report its version, but a minimal Electron app-main preflight timed out before the Plastic main process started. The current validation run now reaches Electron startup, opens the runtime/build HTTP ports, runs the shared contract, and passes method parity against the headless baseline.

`pnpm plastic:validate-unified` is the current automation-friendly validation command. It must:

- run the shared headless runtime contract strictly;
- capture the headless method baseline;
- attempt Electron preflight and headed validation;
- compare Electron methods to headless when Electron is available;
- emit a structured degraded report when Electron cannot start in the current host environment.

This command does not replace `pnpm plastic:validate-electron`. Strict Electron validation remains the proof that headed Electron can start real runtime/build ports and pass the shared contract.

`pnpm plastic:audit-runtime-unification` is the full audit command for this workstream. It runs typecheck, guardrails, strict headless validation, strict Electron validation, and unified parity validation in sequence, then prints one JSON summary.

## Practical Next Step

Keep shrinking host bootstraps and make Electron/headless drift harder to reintroduce. The next architecture slice should move remaining host-specific callback bags into named factories so entrypoints read as wiring, not assembly.

Proof:

1. `PLASTIC_ELECTRON_PREFLIGHT_TIMEOUT_MS=3000 pnpm plastic:validate-electron` reaches Plastic startup logs.
2. Electron starts the runtime and build HTTP ports.
3. `pnpm plastic:contract` passes against Electron's runtime/build URLs.
4. `pnpm plastic:method-parity` compares Electron against the captured headless baseline.
5. Any differences are explained only by capability status, not missing shared methods or discovery affordances.
