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

## Main Gap

The biggest current gap is method legibility.

`plastic/methods` shows method IDs, titles, owners, and some descriptions, but many methods do not yet expose:

- input schemas;
- output schemas;
- examples;
- preconditions;
- side effects;
- durable event types produced;
- verification methods;
- reversibility or undo notes;
- relevant visible refs.

This causes agents to miss capabilities or infer payloads incorrectly. A live example: an agent said panel movement was not exposed even though `panels/move` exists, because the method surface did not teach the agent enough about how to use it.

## Desired Method Metadata

Every method should eventually be describable with:

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
