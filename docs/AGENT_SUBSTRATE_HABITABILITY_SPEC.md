# Agent Substrate Habitability Spec

## Purpose

Plastic now has the first working control spine: agents can discover app state, call Plastic RPC through `plastic_rpc`, create panels, message other chats, scaffold extensions, inspect visible refs, capture screenshots, and run build checks.

That makes Plastic a viable agent substrate prototype.

This spec defines the next improvements required to make Plastic a good place for agents to inhabit. The goal is to move from:

```text
controllable app -> habitable agent environment
```

An agent in Plastic should be able to wake up, understand where it is, understand what changed, point at anything, know what it can do, act through public methods, verify the result, and leave durable traces for future agents.

## Current Assessment

Plastic is already agent-native in the technical sense:

- state is discoverable through `plastic/state`;
- methods are callable through the shared registry;
- Codex agents can reach the registry through the MCP `plastic_rpc` bridge;
- chats, panels, extensions, visible refs, screenshots, and builds are controllable through RPC;
- meaningful actions are appended to the local event stream.

Plastic is not yet fully habitable:

- orientation is too raw;
- event memory is durable but not yet semantically navigable;
- deixis exists, but visible refs do not yet resolve deeply enough into source, state, events, fibers, and available actions;
- extension creation exists, but the path from intent to hot-loaded working UI is still too manual;
- agents do not yet receive a strong embodiment packet describing their current body, neighbors, memory, tools, and obligations.

## Design Goal

Every agent, whether inside a chat panel or outside the app, should receive enough context and control to answer:

- Where am I?
- What can I see?
- What changed since I last acted?
- What does the user appear to be doing?
- What panels, agents, files, tasks, documents, and windows exist?
- What methods can I call from here?
- What visible things can I point at?
- What source, state, events, and runtime work produced this UI?
- What should I verify after I act?
- How do I leave the next agent a better world than I found?

## Core Invariants

- **Agents orient before acting**: an agent should call or receive an orientation packet before mutating Plastic state.
- **State is actionable**: major state responses include links, methods, schemas, refs, and suggested next actions.
- **Events are semantic memory**: the event stream remains append-only, but agents get derived views that explain timelines, causality, and recent changes.
- **Deixis is deep**: any visible `data-plastic-ref` resolves to UI identity, panel, extension, source hints, event lineage, state projection, and mutation methods.
- **Embodiment is explicit**: an agent knows its panel id, thread id, visible window context, nearby panels, available tools, event cursor, and current role.
- **Verification is native**: every meaningful agent-built change has an expected verification path using state, events, refs, screenshots, typecheck, or build output.
- **No hidden path**: internal agents, external agents, bundled panels, and user extensions use the same discovery and control primitives.

## Improvement 1: Agent Orientation Layer

### Problem

`plastic/state` is useful, but it is still a broad dump of app resources. An agent can use it, but it has to work too hard to understand its local situation.

Agents need a compact "you are here" packet, especially when spawned inside a chat panel.

### Proposed Methods

#### `agent/orient`

Returns a compact orientation packet for an agent or panel.

Input:

```ts
{
  agentId?: string;
  panelId?: string;
  windowId?: string;
  eventCursor?: string;
}
```

Output:

```ts
{
  agent: {
    id: string;
    name?: string;
    runtime?: string;
    role?: string;
  };
  embodiment: {
    panelId?: string;
    threadId?: string;
    windowId?: string;
    projectDir?: string;
    model?: string;
    backend?: string;
  };
  visibleContext: {
    focusedPanelId?: string;
    currentPanel?: PlasticPanel;
    neighboringPanels: PlasticPanel[];
    visibleRefs: VisibleRefSummary[];
  };
  memory: {
    latestEventId?: string;
    eventCount: number;
    sinceCursor: EventSummary[];
    recentUserIntents: IntentSummary[];
    recentAgentActions: ActionSummary[];
  };
  capabilities: {
    methods: PlasticMethodSummary[];
    recommendedActions: PlasticAction[];
    links: PlasticLink[];
  };
  obligations: {
    verifyAfterMutation: boolean;
    durableEventsRequired: boolean;
    callPlasticStateBeforeGuessingIds: boolean;
  };
}
```

### Required Behavior

- Chat threads should receive this orientation in developer instructions or as an initial tool-callable packet.
- `agent/orient` should be smaller and more local than `plastic/state`.
- It should include enough links to expand into `plastic/state`, `plastic/methods`, `events/timeline`, `deixis/listVisibleRefs`, and `deixis/resolveRef`.
- It should include an event cursor so the agent can later ask what changed.

### Validation

- Create a Codex chat panel.
- Ask it "where are you and what can you do here?"
- The agent should correctly name its panel id, window context, visible neighboring panels, reachable methods, and how to mutate the app.
- The answer should not require shell access or hidden constants.

## Improvement 2: Semantic Event Memory

### Problem

The event log is durable, but raw events are not enough for agents to feel oriented over time. Agents need summaries, causal chains, timelines, and per-panel memory.

### Proposed Methods

#### `events/timeline`

Returns human/agent-readable event summaries.

Input:

```ts
{
  after?: string;
  before?: string;
  limit?: number;
  scope?: {
    panelId?: string;
    agentId?: string;
    extensionId?: string;
    windowId?: string;
  };
  includeRaw?: boolean;
}
```

Output:

```ts
{
  latestEventId?: string;
  items: Array<{
    eventId: string;
    timestamp: string;
    actor: PlasticActor;
    scope: PlasticScope;
    type: string;
    summary: string;
    causes?: string[];
    effects?: string[];
    links: PlasticLink[];
  }>;
}
```

#### `events/causalChain`

Returns the chain of events that led to a selected event, panel state, message, build result, or ref.

#### `memory/panel`

Returns durable per-panel memory:

- recent user messages;
- recent agent messages;
- commands invoked from that panel;
- visible ref interactions;
- extension changes;
- open tasks related to the panel;
- latest verification status.

#### `memory/agent`

Returns durable per-agent memory:

- recent turns;
- tools used;
- failed actions;
- successful actions;
- event cursor;
- learned preferences;
- follow-up obligations.

### Required Behavior

- Event summaries are derived from raw events and can be rebuilt.
- Raw events remain the source of truth.
- Summary generation should produce durable summary events only when the summary becomes part of app memory; transient summaries can be recomputed.
- Timelines should include links back to raw events and affected resources.

### Validation

- Run the chat-to-chat proof.
- Call `events/timeline` scoped to Chat A.
- It should summarize: user asked Chat A, Chat A called `plastic_rpc`, Chat A created Chat B, Chat A sent Chat B a message, Chat A replied.
- Call `events/causalChain` for Chat B's user message.
- It should connect the message to Chat A's bridge call and original user prompt.

## Improvement 3: Deep Deixis

### Problem

Plastic can list visible refs and screenshot them, but agents need refs to become doorways into the system.

Pointing at a visible thing should answer:

- What is this?
- Who owns it?
- What state produced it?
- What source rendered it?
- What events changed it?
- What methods can mutate it?
- What verification proves a change worked?

### Proposed Methods

#### `deixis/resolveRef`

Input:

```ts
{
  ref: string;
  windowId?: number;
  includeSource?: boolean;
  includeEvents?: boolean;
  includeActions?: boolean;
}
```

Output:

```ts
{
  ref: string;
  element: {
    tag: string;
    text?: string;
    bounds?: Rectangle;
    attributes: Record<string, string>;
  };
  ownership: {
    panelId?: string;
    extensionId?: string;
    agentId?: string;
    methodId?: string;
    commandId?: string;
  };
  state: {
    projection?: unknown;
    resourceLinks: PlasticLink[];
  };
  lineage: {
    recentEvents: EventSummary[];
    sourceHints: SourceHint[];
    fiberHints: FiberHint[];
  };
  actions: PlasticAction[];
  verification: PlasticAction[];
}
```

#### `deixis/comment`

Creates a durable annotation on a ref.

#### `deixis/changeRequest`

Turns a user comment on a visible ref into a structured build/edit request.

### Required Behavior

- Every interactive visible element has a stable `data-plastic-ref`.
- Refs include panel ownership where possible.
- Buttons include command/method identity.
- Chat messages include event/message identity.
- Extension-rendered elements include extension id and source hints.
- `deixis/resolveRef` should produce next actions, not just metadata.

### Validation

- Resolve a chat compose box ref.
- The result should identify the chat panel, owning extension, submit method, recent chat events, and actions to fill/send.
- Resolve an extension panel ref.
- The result should identify the extension manifest, entry file, panel event, and actions to fork/edit/reload/verify.

## Improvement 4: Extension Build Loop

### Problem

Plastic can scaffold and register a simple extension, but the agent path from "make a tool" to "working hot-loaded panel" should be first-class.

### Proposed Methods

- `extensions/readFile`
- `extensions/writeFile`
- `extensions/updateManifest`
- `extensions/reload`
- `extensions/fork`
- `extensions/verify`
- `build/run`
- `build/typecheck`
- `build/test`
- `build/watchStatus`

### Required Behavior

- Extension writes are scoped to `.plastic/extensions` for binary users.
- Source writes are separately exposed for source builds.
- Every write records an event with path, extension id, summary, and correlation id.
- Reload and verification are explicit steps.
- `extensions/verify` should check:
  - manifest parses;
  - extension is discovered;
  - panel is registered or mountable;
  - visible refs exist;
  - screenshot is non-empty;
  - typecheck/build status is known.

### Validation

- Ask an agent in Chat A to create a new panel with one button.
- The agent should scaffold/write the extension, scan/register it, reload if needed, click or inspect the button, capture a screenshot, and record verification.

## Improvement 5: Agent Embodiment Registry

### Problem

Agents are currently represented by events and chat bindings, but embodiment should become a first-class resource.

### Proposed Resources

#### Agent

```ts
{
  id: string;
  name: string;
  runtime: "codex" | "pi" | "custom";
  backend?: string;
  model?: string;
  projectDir?: string;
  panelIds: string[];
  windowIds: string[];
  eventCursor?: string;
  tools: string[];
  memoryRefs: PlasticLink[];
  permissions: PermissionSummary[];
  status: "idle" | "thinking" | "acting" | "blocked" | "offline";
}
```

### Proposed Methods

- `agents/list`
- `agents/get`
- `agents/orient`
- `agents/setCursor`
- `agents/message`
- `agents/spawn`
- `agents/stop`

### Required Behavior

- Each chat-bound Codex thread has an agent resource.
- Each agent knows which panel or panels embody it.
- Multiple agents can operate in the same workspace and talk through panels or direct RPC.
- Agents can discover each other through `plastic/state`.

### Validation

- Open three chat panels with different project dirs/models/backends.
- `agents/list` should show three embodied agents.
- Each agent can call `agents/orient` and see itself, its panel, and neighboring agents.

## Improvement 6: Agent Comfort And Etiquette

### Problem

An agent substrate should not only be powerful; it should be calm to operate. Agents need norms that keep the workspace legible.

### Requirements

- Agents announce durable changes through concise chat messages or events.
- Agents avoid guessing ids when discovery methods exist.
- Agents verify after mutation.
- Agents record failures as first-class events.
- Agents prefer narrow changes.
- Agents leave handoff summaries when a long-running task changes workspace shape.
- Agents use comments/annotations for ambiguous UI requests instead of silently editing.

### Proposed Method

#### `agent/handoff`

Records a concise durable handoff:

```ts
{
  agentId: string;
  summary: string;
  changed: string[];
  verified: string[];
  next: string[];
  blockers: string[];
}
```

## Suggested Implementation Order

1. Add `agent/orient` and include it in Codex chat developer instructions.
2. Add `events/timeline` with simple deterministic summaries for known event types.
3. Upgrade `deixis/resolveRef` to return ownership, lineage, and actions.
4. Add `agents/list` and model chat thread bindings as embodied agents.
5. Add `extensions/verify` and richer extension write/reload methods.
6. Add `events/causalChain` for bridge calls, chat messages, panels, builds, and refs.
7. Add `agent/handoff` for durable long-running work summaries.

## Definition Of Done

Plastic becomes a habitable agent substrate when:

- a new agent can orient itself without private context;
- a new agent can explain recent workspace activity from semantic memory;
- a user can point at any visible element and an agent can resolve it to state, source, events, and actions;
- an agent can build and verify a non-trivial extension using only Plastic primitives;
- multiple embodied agents can discover, message, and coordinate with each other;
- every meaningful agent action leaves durable, replayable evidence;
- the same loops work from inside Plastic and outside Plastic.

## Near-Term Success Test

The next practical milestone should be:

1. Start Plastic.
2. Create Chat A.
3. Chat A calls `agent/orient`.
4. Chat A explains where it is and what it can do.
5. The user points at Chat A's compose box.
6. Chat A resolves the ref, describes its source/state/event lineage, and fills/sends a message through `deixis/fillRef` and `deixis/clickRef`.
7. Chat A creates a small extension, verifies it visually, and records `agent/handoff`.

If that works repeatably after restart, Plastic will feel much less like an app with agent controls and much more like an environment agents can inhabit.
