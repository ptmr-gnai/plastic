# Agent Primitives and Method Legibility

Plastic's control plane should make every meaningful user action available to agents through the same local substrate. If a human can do something in the app, an in-app agent and an outside local agent should be able to discover, understand, perform, and verify the same action through RPC.

## Principle

Every user-visible affordance should have:

1. A durable event.
2. An RPC method.
3. A method schema.
4. A HATEOAS action from relevant resources.
5. A way to verify the effect.
6. A visible/deictic reference when it appears in the UI.

The goal is not just to expose more methods. The goal is to make the environment legible enough that agents can act without guessing payload shapes, hidden preconditions, or success criteria.

## Current Shape

Plastic already exposes useful control primitives:

- App: `app/setTheme`
- Panels: `panels/create`, `panels/rename`, `panels/move`, `panels/remove`, `panels/close`, `panels/list`
- Windows: `windows/create`, `windows/focusPanel`, `windows/scrollToRef`, `windows/screenshot`
- Chat: `chats/createCodexChat`, `chats/sendToCodex`, `chats/messages`, `chats/close`, `chats/interrupt`
- Events and state: `plastic/state`, `plastic/snapshot`, `agent/workbench`, `events/list`, `events/timeline`
- Deixis/UI: `deixis/listVisibleRefs`, `deixis/resolveRef`, `deixis/clickRef`, `deixis/fillRef`, `deixis/evalDom`
- Extensions: `extensions/scan`, `extensions/verify`, `extensions/verifyAll`, `extensions/verificationStatus`, `extensions/activate`, `extensions/forkBundled`, `extensions/registerPanel`
- Build/Codex bridge: typecheck, Codex thread/turn/config passthrough, MCP bridge

This means the substrate already supports meaningful side-channel control. For example, an outside local agent can inspect panels, move panels, create chats, send chat messages, read transcripts, reload extensions, and verify app health without touching the GUI.

## Current Invariant

Method legibility is now a runtime contract, not just a goal.

Every method currently exposed through `plastic/methods`, runtime `/methods`, and build `/methods` must expose:

- input schemas;
- output schemas;
- examples;
- side effects;
- durable event types produced;
- reversibility or undo notes;
- describe/invoke links.

The contract harness enforces this globally with `assertMethodCatalogSurface`, and `pnpm plastic:validate-unified` validates it against both headless and Electron hosts. The latest captured headless catalog has 86 methods and zero missing metadata fields.

The remaining legibility work has moved up a layer:

- expose more HATEOAS actions from contextual resources, not only from method descriptions;
- attach visible/deictic refs to more UI affordances;
- make settings and layout explicit durable primitives;
- replace broad JSON-schema objects with Effect Schema or another typed schema source when the runtime is ready.

`plastic/state` and `plastic/snapshot` now project each active panel as an individual `kind: "panel"` resource. A panel resource must expose concrete links/actions with prefilled method inputs for `panels/get`, `panels/rename`, `panels/move`, and `panels/remove`. Chat panels also expose `chats/messages` and `chats/sendToCodex` actions with the relevant `chatId`. This is the first contextual-resource contract: an agent can pick a panel from state or snapshot and act on it without separately inferring the payload key or panel id.

`agent/workbench` and `agent/orient` now follow the same rule when called with a panel context. Their recommended actions include focused panel read/control actions with exact panel inputs, and chat panel contexts include exact chat message actions. This keeps agent packets aligned with the state/snapshot HATEOAS resources instead of forcing agents to translate between packet context and RPC payloads.

`deixis/resolveRef` now follows the same rule for visible UI references. Resolved refs with panel ownership expose concrete panel resource links and concrete panel read/control actions, so an agent can point at visible UI and receive directly invokable RPC payloads.

`plastic/state` and `plastic/snapshot` also project individual `kind: "extension"` resources. Extension resources expose concrete get, activate, verify, register-panel, fork, timeline, and method-description affordances using the correct `id` or `extensionId` payload shape for each method.

`plastic/state` and `plastic/snapshot` now project individual `kind: "window"` resources. Window resources expose concrete focus and scroll actions for their projected panels, using exact `panelId` and `panel:<id>` ref payloads.

The contract harness now verifies HATEOAS method integrity for `plastic/state` and `plastic/snapshot`: every resource link/action that names an RPC method must reference a method present in the live method catalog, with transport-only links such as `http/post` explicitly exempted.

Resource, agent-packet, and transport actions must also be input-legible. If an action points at a method whose live catalog entry has an input shape, the action must provide concrete `input` satisfying required fields or an `inputSchema`. This keeps generic app, panel, extension, window, host, `agent/workbench`, `agent/orient`, HTTP RPC, and MCP bridge actions directly callable from their discovery packets.

## Required Method Metadata

Every method must be describable with:

```ts
interface PlasticMethodDescription {
  id: string;
  title: string;
  description: string;
  owner: {
    kind: "runtime" | "extension" | "agent" | "panel";
    id: string;
  };
  inputSchema: unknown;
  outputSchema?: unknown;
  examples: Array<{
    title: string;
    input: unknown;
    expectedEvents?: string[];
    verifyWith?: {
      method: string;
      input: unknown;
    };
  }>;
  effects: {
    durableEvents: string[];
    mutatesProjection?: string[];
    opensWindow?: boolean;
    touchesFilesystem?: boolean;
    startsProcess?: boolean;
  };
  preconditions?: string[];
  reversibility?: {
    reversible: boolean;
    method?: string;
    notes?: string;
  };
  links?: Array<{
    rel: string;
    href: string;
    method?: string;
    target?: string;
    input?: unknown;
  }>;
  actions?: Array<{
    id: string;
    title: string;
    method: string;
    input?: unknown;
    inputSchema?: unknown;
  }>;
}
```

## Next Primitives

The highest-value new primitives are:

- `methods/describe`: return full schemas, examples, effects, and verification hints for one method.
- `settings/list`, `settings/get`, `settings/set`: expose theme, density, font size, model defaults, and feature flags as durable settings.
- `layout/get`, `layout/apply`, `layout/reset`: make panel/window layout explicit and replayable.
- `panels/focus`, `panels/duplicate`, `panels/pin`, `panels/unpin`, `panels/resize`: match common human layout actions.
- `windows/close`, `windows/move`, `windows/setLayout`: complete the window control surface.
- `commands/list`, `commands/run`: provide command-palette style action discovery.
- `events/rewindPreview` and `events/rewindApply`: make rewind safe and inspectable before mutating projections.
- `agent/capabilities`: summarize what an agent can safely do now, given app state and focused context.

## Verification Pattern

Every action should have an empirical validation loop:

1. Call the RPC method.
2. Read the produced event or returned event ID.
3. Query the relevant projection.
4. Confirm the projection changed as expected.
5. Record the result in the event stream when useful.

Example:

```json
{
  "method": "panels/move",
  "input": {
    "id": "chat-main",
    "order": 2
  },
  "verifyWith": {
    "method": "panels/list",
    "input": {}
  },
  "expectedEvents": ["panel.moved"]
}
```

## Invariant

An action is not fully part of Plastic until it is available in all three places:

- visible to humans in the GUI when relevant;
- discoverable to agents through HATEOAS/method metadata;
- controllable from outside the GUI through the same local RPC bus.
