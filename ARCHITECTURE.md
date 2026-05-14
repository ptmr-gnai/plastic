# Plastic Architecture

## 1. Purpose

This document defines the first concrete contracts for Plastic: events, RPC, extension manifests, panel/window binding, live build control, and the deixis/meta-layer.

`PROJECT_PLAN.md` describes what Plastic wants to become. This document describes the v0 architecture we should start building.

## 2. Core Model

Plastic is a local agent-native environment. The app is made of:

- a protected runtime;
- a shared durable event stream;
- windows;
- panels;
- extensions;
- agents;
- RPC methods;
- HATEOAS-style capability discovery;
- build/runtime control sockets;
- a DOM/source/fiber deixis layer.

Everything meaningful goes through the event stream. Everything controllable is exposed through RPC. Everything visible should be inspectable by agents.

## 3. Event Store

Plastic owns its own event store. Agent runtimes such as Codex may also save their own chats, but Plastic still records all meaningful agent messages and app actions in one shared stream.

Frontend views may keep transient local state, but meaningful changes become durable events.

### 3.1 Storage

v0 can use either:

- JSONL for simple append-only durability and easy inspection;
- SQLite for indexed queries and transactional writes.

Recommendation for v0: start with JSONL plus periodic snapshots, then add SQLite read models once query pressure appears. If SQLite is chosen first, keep the event table append-only and easy to export as JSONL.

### 3.2 Event Envelope

All events should share one envelope:

```ts
export interface PlasticEvent<TType extends string = string, TPayload = unknown> {
  id: string;
  type: TType;
  version: number;
  timestamp: string;
  actor: PlasticActor;
  scope: PlasticScope;
  correlationId?: string;
  causationId?: string;
  payload: TPayload;
  meta: PlasticEventMeta;
}

export interface PlasticActor {
  kind: "user" | "agent" | "extension" | "system" | "cron";
  id: string;
  name?: string;
}

export interface PlasticScope {
  workspaceId: string;
  windowId?: string;
  panelId?: string;
  extensionId?: string;
  agentId?: string;
  projectDir?: string;
}

export interface PlasticEventMeta {
  tags?: string[];
  links?: PlasticLink[];
  redactions?: PlasticRedaction[];
  transient?: false;
}
```

Transient events may exist in frontend memory, but if an event reaches the durable store, it represents meaningful history.

### 3.3 Initial Event Types

Core runtime:

- `runtime.started`
- `runtime.stopped`
- `theme.changed`
- `permission.granted`
- `permission.revoked`

Windows and panels:

- `window.created`
- `window.closed`
- `window.layout.updated`
- `panel.created`
- `panel.focused`
- `panel.moved`
- `panel.resized`
- `panel.closed`
- `panel.button.added`
- `panel.button.invoked`

Chats:

- `chat.created`
- `chat.message.appended`
- `chat.user_message.injected`
- `chat.agent_message.appended`

Documents:

- `document.created`
- `document.updated`
- `document.renamed`
- `document.rewound`

Tasks and crons:

- `task.created`
- `task.updated`
- `task.completed`
- `task.cron.scheduled`
- `task.cron.triggered`
- `task.cron.paused`
- `task.cron.proposal.created`

Extensions:

- `extension.discovered`
- `extension.loaded`
- `extension.reloaded`
- `extension.failed`
- `extension.forked`

Agents:

- `agent.registered`
- `agent.message.appended`
- `agent.command.requested`
- `agent.command.completed`
- `agent.command.failed`

Build:

- `build.started`
- `build.succeeded`
- `build.failed`
- `hmr.updated`

Deixis:

- `annotation.created`
- `annotation.resolved`
- `reference.resolved`

### 3.4 Read Models

Read models are derived projections from the event stream. They can be rebuilt.

Initial read models:

- workspace state;
- windows;
- panels;
- chats;
- documents;
- tasks and recurring tasks;
- extensions;
- agents;
- buttons/flows;
- annotations;
- build status.

## 4. RPC

RPC is the control plane. Events are the durable history.

Any agent, panel, extension, or external process can discover and call methods, subject to the v0 permissive model.

### 4.1 HATEOAS Principle

Plastic should teach agents how to use it. State responses must include available actions, links, schemas, and method references.

Do not return inert state when actionable state is possible.

Example:

```ts
export interface PlasticResource<T = unknown> {
  id: string;
  kind: string;
  title?: string;
  state: T;
  links: PlasticLink[];
  actions: PlasticAction[];
}

export interface PlasticLink {
  rel: string;
  href: string;
  method?: string;
  target?: string;
}

export interface PlasticAction {
  id: string;
  title: string;
  method: string;
  inputSchema?: unknown;
  description?: string;
}
```

### 4.2 Required Discovery Methods

`plastic/state`

Returns the current app state as HATEOAS resources:

- workspace;
- windows;
- panels;
- extensions;
- agents;
- tasks;
- chats;
- documents;
- available methods;
- build status;
- annotations;
- visible DOM/deixis references where available.

`plastic/methods`

Returns all registered RPC methods, including extension methods.

`plastic/resource`

Returns one resource by ID or reference.

`plastic/subscribe`

Subscribes to events, read-model changes, build updates, or method registry changes.

### 4.3 Method Registry

Each method should include:

```ts
export interface PlasticMethod {
  id: string;
  title: string;
  description?: string;
  owner: {
    kind: "runtime" | "extension" | "agent" | "panel";
    id: string;
  };
  inputSchema?: unknown;
  outputSchema?: unknown;
  permissions?: string[];
  links?: PlasticLink[];
}
```

Extensions can register new methods at load time. Their manifests should declare expected methods, but runtime registration is allowed so generated or dynamic capabilities can still exist.

### 4.4 Initial Runtime Methods

State and discovery:

- `plastic/state`
- `plastic/methods`
- `plastic/resource`
- `plastic/subscribe`

Events:

- `events/append`
- `events/list`
- `events/subscribe`
- `events/replay`
- `events/snapshot`
- `events/rewind`

Windows and panels:

- `windows/list`
- `windows/create`
- `windows/updateLayout`
- `panels/list`
- `panels/create`
- `panels/focus`
- `panels/move`
- `panels/resize`
- `panels/close`

Chat:

- `chats/list`
- `chats/create`
- `chats/appendMessage`
- `chats/injectUserMessage`
- `chats/addButton`

Documents:

- `documents/list`
- `documents/create`
- `documents/read`
- `documents/update`

Tasks:

- `tasks/list`
- `tasks/create`
- `tasks/update`
- `tasks/createRecurring`
- `tasks/pauseRecurring`
- `tasks/runRecurringNow`

Extensions:

- `extensions/list`
- `extensions/load`
- `extensions/reload`
- `extensions/fork`
- `extensions/registerMethod`

Agents:

- `agents/list`
- `agents/register`
- `agents/sendMessage`
- `agents/runCommand`

App settings:

- `app/setTheme`
- `app/getTheme`

Deixis:

- `deixis/evalDom`
- `deixis/listVisibleRefs`
- `deixis/resolveRef`
- `deixis/createAnnotation`
- `deixis/listAnnotations`
- `deixis/sourceForRef`
- `deixis/fibersForRef`

Build:

- `build/status`
- `build/trigger`
- `build/diagnostics`
- `build/subscribe`

### 4.5 Example: Five-Second Chat Button

An agent should be able to create a chat button that injects a user message with one or two RPC calls:

```ts
await rpc.call("chats/addButton", {
  chatId: "chat-main",
  button: {
    id: "summarize-project",
    label: "Summarize project",
    action: {
      method: "chats/injectUserMessage",
      input: {
        chatId: "chat-main",
        content: "Summarize the current project and suggest next steps."
      }
    }
  }
});
```

This appends `panel.button.added`. When clicked, it appends `panel.button.invoked` and `chat.user_message.injected`.

## 5. Control Sockets

Plastic should expose two local control channels from the beginning.

### 5.1 Runtime Socket

The runtime socket observes and controls the running app:

- events;
- windows;
- panels;
- chats;
- documents;
- tasks;
- agents;
- extensions;
- themes;
- annotations;
- DOM/deixis references.

### 5.2 Build Socket

The build socket observes and controls the live build environment:

- Vite status;
- HMR updates;
- extension compilation;
- diagnostics;
- source graph lookup;
- generated files;
- reloads.

The two sockets may share protocol shapes, but they should be separate endpoints so agents can distinguish app control from build control.

## 6. Extensions

Extensions are the app surface. Bundled panels are extensions. User panels are extensions. Generated workflows are extensions.

### 6.1 Extension Location

Workspace-local extensions live at:

```text
.clay/extensions/
```

Supported extension forms:

```text
.clay/extensions/quick-note.tsx
.clay/extensions/command-pack.ts
.clay/extensions/review-panel/index.tsx
.clay/extensions/review-panel/main.ts
.clay/extensions/review-panel/clay.extension.json
```

### 6.2 Manifest

Folder extensions should include a manifest. Single-file extensions can start without one, but Plastic should generate or infer a manifest and let the user/agent edit it later.

```ts
export interface PlasticExtensionManifest {
  id: string;
  name: string;
  version: string;
  entry?: {
    panel?: string;
    main?: string;
    styles?: string;
  };
  panels?: PlasticPanelContribution[];
  methods?: PlasticMethodContribution[];
  buttons?: PlasticButtonContribution[];
  events?: PlasticEventContribution[];
  readModels?: PlasticReadModelContribution[];
  agents?: PlasticAgentContribution[];
  env?: PlasticEnvRequirement[];
  permissions?: string[];
  source?: {
    repository?: string;
    forkedFrom?: string;
  };
}
```

### 6.3 Extension Registration

Extensions can:

- contribute panels;
- register methods;
- contribute buttons/flows;
- emit event types;
- define read models;
- provide agents;
- schedule recurring work;
- expose source/deixis metadata.

### 6.4 `.tsx` Panel Contract

A single-file `.tsx` extension should be enough for a panel experiment.

The first version can use a tiny runtime API:

```ts
export default function Panel(ctx: PlasticPanelContext) {
  return html`
    <section>
      <h1>Quick Note</h1>
      <textarea></textarea>
    </section>
  `;
}
```

The exact rendering helper can change, but the contract should stay simple:

- receive context;
- render DOM;
- call RPC;
- subscribe to state/events;
- expose metadata for deixis.

## 7. Panels And Windows

Plastic does not assume one project per app window.

One window can contain:

- a chat panel bound to project A, Codex, model X;
- a document panel bound to project B;
- a task panel showing cross-project crons;
- an agent control panel bound to another backend.

Another window can contain a different arrangement over the same shared event fabric.

### 7.1 Panel Binding

Panels should declare binding context:

```ts
export interface PlasticPanelBinding {
  panelId: string;
  projectDir?: string;
  agentId?: string;
  model?: string;
  backend?: string;
  chatId?: string;
  documentId?: string;
  taskFilter?: unknown;
}
```

Panel binding is state, and binding changes are durable events.

### 7.2 Cross-Panel Communication

Panels communicate through RPC methods and the event stream.

Examples:

- a task panel asks a chat panel to inject a user message;
- a code review panel sends selected files to an agent panel;
- a cron panel adds a button to the chat panel;
- a panel in one window focuses a related panel in another window.

## 8. Deixis And DOM Inspection

Agents can inspect/eval the DOM at any time through RPC. Users can also enter an explicit point/comment/build mode through a button or keyboard shortcut.

### 8.1 DOM Metadata

Rendered UI should include metadata where possible:

```html
<button
  data-plastic-ref="panel-button:summarize-project"
  data-plastic-panel="chat-main"
  data-plastic-extension="bundled.chat"
  data-plastic-command="chats/injectUserMessage"
>
  Summarize project
</button>
```

### 8.2 Reference Resolution

`deixis/resolveRef` should map a UI reference to:

- DOM node summary;
- panel ID;
- window ID;
- extension ID;
- command/method IDs;
- related events;
- source files and line hints where available;
- active fibers/tasks where available;
- available actions.

### 8.3 Commenting And Building

When the user comments on a UI element, Plastic appends an `annotation.created` event. An agent can then:

1. resolve the referenced UI element;
2. inspect source and running fibers;
3. propose or apply a change;
4. trigger build/HMR;
5. append events describing what changed.

This is the fourth-wall layer: the app exposes itself as something agents can understand and reshape.

## 9. Agent Embodiment

Plastic embodies Codex first, while leaving room for other agent runtimes.

An embodied agent gets:

- identity in the event stream;
- access to `plastic/state`;
- access to method discovery;
- ability to read all agent/user messages;
- ability to inspect DOM and source;
- ability to call runtime/build RPC;
- ability to create panels, buttons, tasks, documents, and annotations.

Agent messages are always written into Plastic's event stream.

## 10. Permissions For v0

v0 is fully permissive.

No permission prompts should interrupt the first prototype. The safety layer is:

- local-only default transport;
- durable event log;
- visible auditability;
- recovery mode;
- ability to disable extensions.

Permission boundaries can be added later without changing the RPC/event architecture, because method metadata already includes permission fields.

## 11. First Implementation Order

1. Scaffold Electron + Vite + TypeScript + Effect.
2. Add JSONL event store.
3. Add method registry and `plastic/state`.
4. Add runtime socket.
5. Add build socket stub.
6. Add horizontal window/panel shell.
7. Add bundled chat/document/tasks extensions.
8. Add `.clay/extensions` loader.
9. Add single-file `.tsx` panel support.
10. Add chat buttons and `chats/injectUserMessage`.
11. Add DOM metadata and `deixis/listVisibleRefs`.
12. Add Codex adapter.
13. Add build/HMR diagnostics.

