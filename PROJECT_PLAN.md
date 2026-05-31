# Agent-Native Electron Workspace: Planning Doc

## 1. Product Vision

Build an agent-native desktop environment where humans and agents collaborate through a live, extensible GUI. The app is not a conventional first-party product with a plugin system bolted on. It is a protected runtime plus exposed primitives: panels, documents, tasks, chats, agents, environment, RPC, durable events, deixis, and hot-reloadable extensions that can be composed while the app is running.

The guiding idea is closer to Smalltalk or Lisp than to a static Electron app: the system should be inspectable, scriptable, extendable, and modifiable from inside itself. Agents should not merely use the app. The app should embody Codex, or another agent runtime, as a living participant in the interface. Agents should be able to observe the whole app, reason over it, modify it, add panels, wire workflows, expose new user interfaces, and build the app while the user is using it.

Everything visible in the app should be a projection of local durable state. User actions, agent actions, chat messages, task changes, document edits, panel layout changes, extension installs, environment changes, and meaningful app interactions are all recorded as events. The GUI renders from derived state, and the event store provides the ability to rewind to any meaningful previous state.

The production and development environments should be the same environment. Building the app is not a separate mode that happens elsewhere; it happens through the app, against the same observable state, extensions, panels, RPC, source graph, and fibers that the user is already touching.

## 2. Core Principles

- **Agent-native by default**: every meaningful app capability should be observable and controllable by agents through typed APIs.
- **Everything is an extension**: chat, documents, tasks, and anything bundled with the app are extensions over the same primitives. Bundled extensions can be forked, modified, replaced, or removed, subject only to the protected runtime and recovery boundary.
- **GUI as state projection**: the interface is a thin projection over derived workspace state. Durable action flows through the event store first.
- **Live composition**: users can ask an agent to create a new panel, tool, view, button, workflow, or theme change and have it appear without rebuilding the whole app.
- **Self-building app**: the app can build the app. Development tools, source traversal, compile errors, HMR, extension scaffolding, and runtime inspection are exposed through the same panel/RPC/event primitives as normal use.
- **Protected runtime, open surface**: boot, recovery, event integrity, permissions, and extension loading remain immutable and recoverable, while all user-facing capabilities are extensions.
- **Local-first extensibility**: a user with only the binary can add extensions; a user with source can modify everything beyond the protected runtime.
- **Typed all the way down**: TypeScript throughout, with Effect used for runtime, services, dependency injection, errors, fibers, resources, config, and RPC boundaries.
- **Everything addressable**: panels, agents, documents, tasks, env vars, commands, events, read models, and extension capabilities have stable identities.
- **Hot-reload as workflow**: building the app while using the app is a core use case, not a dev-only afterthought.
- **Spatial accumulation**: the app is not a traditional sidebar/chat/artifact layout. The default workspace grows left-to-right as the user keeps adding panels.
- **Deixis everywhere**: anything in the app can be pointed at, commented on, inspected, and used as a reference for building. UI, bundled extensions, user extensions, events, commands, source code, and fibers all participate in this meta-layer.

## 3. Technology Commitments

- **Language**: TypeScript only.
- **Runtime model**: Effect for services, dependency layers, typed errors, structured concurrency, config, resource scopes, and RPC schemas.
- **Shell**: Electron.
- **UI**: HTML, CSS, and small TypeScript view controllers to start. Avoid React and complex client-side state management until there is a proven need.
- **State model**: local event store as the durable source of truth; derived read models feed GUI projections.
- **Build tooling**: Vite for the desktop renderer and extension development, with real-time HMR/recompilation as a product feature.
- **IPC/RPC**: typed RPC over Electron IPC internally, with an external transport for out-of-process agents.
- **Persistence**: local append-only event store saves every durable action in the app. A queryable database/read model may be added for indexing and fast projections.
- **Control sockets**: the app should expose separate runtime and build control ports/sockets so agents can control the running product and the live build/HMR environment without conflating the two channels.

Vite should handle fast renderer and extension feedback loops. Extension HMR should feel like editing a living app: save a `.tsx`, `.ts`, `.css`, or manifest file, and the relevant panel or command reloads without resetting the whole workspace.

## 4. Product Shape

### 4.1 Bundled Starter Extensions

The initial GUI ships with three bundled starter panels. These are not special first-party app surfaces; they are extensions included in the default distribution and built on the same public primitives as user-created panels.

- **Chat panel**: Markdown conversation view between human and one or more agents, similar in feel to ChatGPT.
- **Document panel**: Markdown viewer and editor for shared work artifacts.
- **Tasks panel**: task state, agent assignments, progress, dependencies, outcomes, and recurring tasks/crons presented simply.

Each panel is:

- named;
- addressable by ID;
- observable through RPC;
- controllable through typed commands;
- rendered as a projection of derived state;
- allowed to publish capabilities;
- allowed to subscribe to app events;
- forkable and replaceable.

Because these starter panels are extensions, a user can fork the chat panel, replace the document editor, or create a different tasks panel without violating the architecture.

The bundled chat extension should hint that the app is extensible. At the top of the chat panel, it should include an expandable row for buttons, flows, and feature affordances. Agents and cron jobs can add useful buttons there over time, such as "Summarize project", "Make task list", "Open review panel", or a user-specific workflow learned from recent activity.

### 4.2 Workspace Layout

The app should not default to a traditional side panel plus chat plus artifact layout. The primary spatial model is a horizontal, left-to-right workspace:

- panels are arranged in an infinite horizontal scroll;
- adding a panel usually places it to the right of the current working area;
- users can keep multiple related panels visible in sequence;
- panels can be named, resized, focused, forked, and moved;
- layout changes are durable events;
- the same project can be opened in multiple windows with different panel arrangements.

This makes the app feel like a living table of work rather than a fixed IDE shell.

### 4.3 Extension Panels

Users can ask an agent to create new panels. A panel extension should be able to define:

- a manifest;
- a name and stable ID;
- HTML/CSS/TypeScript renderer entry point;
- command handlers;
- RPC capabilities;
- event schemas it emits;
- read models it contributes;
- required permissions;
- persisted local state derived from events;
- environment variable requirements;
- hot-reload behavior;
- fork lineage when derived from another extension.

Examples:

- Kanban board generated from tasks.
- Code review panel.
- Agent memory browser.
- Database inspector.
- Timeline view of all app events.
- Cron monitor for recurring tasks.
- Custom control surface for a specific external agent.

## 5. Agent Embodiment Model

An agent is not just a chat participant. It can be granted a body inside the app:

- identity;
- permissions;
- workspace context;
- panel visibility;
- command access;
- event subscriptions;
- environment variables;
- tools;
- memory/state;
- optional custom panel surfaces.

Agents can run:

- **inside the app process model**, using internal services and app RPC;
- **outside the app**, connecting through the external RPC server;
- **as extension-provided agents**, bundled with a panel or workflow.

The app should also wrap other coding agents through ACP or provider SDKs. The first integration target should be Codex because its app/server architecture aligns naturally with this project: an app can host the human-facing workspace while Codex or Codex-like agents connect through the control plane and act on exposed primitives.

Any agent in any panel should be able to request any app action through RPC, subject to permissions. For example, the user can tell an agent "turn the app to dark mode", and the agent should call the relevant command, append the durable theme/layout events, and every open window should update from the shared state projection.

The RPC layer should make small UI changes trivial. For example, creating a button that injects a specific user message into chat should be a five-second operation: register the button, bind it to a command, append the button event, and have the chat panel project it immediately.

The agent should be able to ask questions such as:

- What panels exist?
- What document is active?
- What tasks are blocked?
- What recurring tasks are scheduled?
- What commands are available?
- What environment variables are defined?
- What extensions are installed?
- What changed in the app since timestamp X?
- What durable events led to the current state?
- What state would exist if the workspace were rewound to event N or timestamp T?
- What source file, extension, command, fiber, or event produced this UI element?
- What can I safely change to modify the thing the user is pointing at?

And perform actions such as:

- open, close, split, rename, or focus panels;
- create windows or move panels between windows;
- create tasks and recurring tasks;
- edit documents;
- send chat messages;
- register a new command;
- add buttons or flows to existing panels;
- inject a user message into chat from a button or flow;
- change app theme or other GUI state;
- inspect and modify source linked to a UI element;
- inspect running fibers/tasks associated with a panel or command;
- build and mount a new extension panel;
- observe app events;
- rewind or branch workspace state when granted permission;
- request permissions from the user.

## 6. App Primitives

The app should expose a small set of composable primitives rather than a large set of fixed workflows.

### 6.1 Workspace

The root state container for a user session.

Responsibilities:

- panel registry;
- window registry;
- document registry;
- task registry;
- agent registry;
- extension registry;
- env var registry;
- permissions;
- local event store;
- derived read models;
- snapshots;
- rewind/branch metadata;
- source/deixis index;

### 6.2 Windows

A project can have multiple windows. Each window is a projection over the same workspace state but can keep a different panel arrangement.

Window requirements:

- stable window IDs;
- per-window horizontal panel layout;
- shared access to workspace events and read models;
- ability to open the same panel or related panels in multiple windows;
- cross-window panel communication through the event store and RPC;
- durable window layout events;
- theme and global UI state synchronized where appropriate.

### 6.3 Local Event Store

The local event store is the durable backbone of the app. Every meaningful action that changes app state is recorded, including chat, document edits, task changes, recurring task runs, panel layout changes, extension lifecycle changes, agent actions, environment updates, permissions, and user interactions that matter to reconstructing the workspace.

Requirements:

- append-only durable writes;
- stable event IDs;
- typed event schemas;
- actor identity for user, agent, extension, or system;
- timestamp and causal metadata;
- command correlation IDs;
- snapshot support for fast restore;
- replay into derived read models;
- rewind to any meaningful state;
- branch from a historical state when needed;
- redaction boundaries for sensitive values.

Events are both the audit stream and the primary history of the app. Read models can be rebuilt from events, and UI panels should render from those read models rather than maintain separate hidden state.

Example events:

- `panel.created`;
- `panel.focused`;
- `window.created`;
- `window.layout.updated`;
- `document.updated`;
- `document.rewound`;
- `task.created`;
- `task.completed`;
- `task.cron.scheduled`;
- `task.cron.triggered`;
- `agent.message.created`;
- `agent.command.requested`;
- `extension.loaded`;
- `extension.reloaded`;
- `panel.button.added`;
- `theme.changed`;
- `command.executed`;
- `env.updated`;
- `permission.requested`.

### 6.4 Panels

Named UI surfaces with lifecycle, state, and capabilities.

Panel lifecycle:

- registered;
- mounted;
- focused;
- hidden;
- disposed;
- reloaded;
- forked.

Panels across all windows can talk to each other through events, commands, and RPC. Direct hidden coupling should be avoided; the normal path is to publish durable intent and let other panels subscribe or query read models.

### 6.5 Commands

Typed actions exposed by runtime services, panels, agents, and extensions.

Command metadata:

- ID;
- name;
- description;
- schema;
- permissions;
- handler location;
- durable event outputs;
- undo/redo or rewind behavior if available.

### 6.6 Documents

Shared editable artifacts. The first version should be Markdown-first:

- Markdown editor;
- Markdown preview;
- document events stored durably;
- simple source view before richer block editing;
- path to CRDT-backed or block-structured documents later if the app needs collaborative editing.

### 6.7 Chats

Chats are Markdown transcripts backed by durable events.

Chat requirements:

- ChatGPT-like Markdown display;
- user and agent message identity;
- tool/action call visibility;
- event references for app actions taken from chat;
- transcript rewind through the event store;
- expandable top row for user, extension, agent, or cron-added buttons;
- ability for alternate chat extensions to render the same underlying chat state differently.

### 6.8 Tasks

Structured work items that humans and agents can create, modify, execute, and observe.

Task fields:

- ID;
- title;
- description;
- status;
- assignee;
- dependencies;
- artifacts;
- activity log.

Recurring tasks/crons are first-class task records, not a separate scheduler UI bolted on later.

Recurring task fields:

- schedule;
- next run;
- last run;
- status;
- owner;
- linked command or agent instruction;
- run history;
- pause/resume state.

Recurring tasks can learn from usage. A cron can observe recent durable events, infer a useful repeated workflow, and spawn a button or flow overnight, subject to user-visible approval and permissions.

### 6.9 Environment Variables

Named configuration values scoped to:

- app;
- workspace;
- extension;
- agent;
- panel;
- session.

Sensitive values should be stored separately from normal state and redacted in logs.

### 6.10 Deixis And Meta-Layer

Deixis is the app's ability to let the user or agent point at any visible or invisible part of the system and say "this", "that button", "this panel", "the thing that rendered this", or "the fiber behind this task".

Requirements:

- every visible UI element can carry stable metadata linking it to panel, extension, command, event, read model, source file, and runtime fiber where available;
- users can comment on or reference any UI element;
- agents can resolve references from comments or selections into concrete app objects;
- source traversal connects UI elements back to extension files, bundled extension source, runtime services, and command handlers;
- fiber/task inspection connects visible work to running Effect fibers, agent runs, schedulers, and command executions;
- comments and annotations are durable events;
- extensions inherit the same pointing/commenting system automatically;
- the meta-layer can be used to build: "change this", "make this button darker", "add a button here", "split this panel", "show me the code for this".

This is the app breaking the fourth wall on purpose. The user should be able to point at the app, talk about the app, and have an agent traverse from interface to source to runtime and back.

## 7. RPC And Control Plane

The app needs APIs for observing and controlling the entire app.

### 7.1 Internal RPC

Used by:

- renderer panels;
- protected runtime services;
- internal agents;
- extensions.

Likely transport:

- Electron IPC wrapped in Effect services and typed schemas.

### 7.2 External RPC

Used by:

- outside agents;
- local CLIs;
- automation scripts;
- other desktop apps.

Candidate transports:

- local WebSocket;
- stdio bridge;
- Unix domain socket / named pipe;
- HTTP on localhost.

Initial recommendation: implement one local WebSocket or HTTP transport first, then add stdio if agent integrations need it.

### 7.3 RPC Capabilities

Minimum early capabilities:

- append event;
- read event stream;
- replay events;
- create snapshot;
- rewind workspace;
- branch workspace;
- list windows;
- create window;
- update window layout;
- move panel between windows;
- list panels;
- create panel;
- focus panel;
- remove panel;
- list commands;
- execute command;
- register button;
- bind button to command;
- list documents;
- read document;
- update document;
- list chats;
- append chat message;
- inject user message into chat;
- add panel button;
- list tasks;
- create task;
- create recurring task;
- update task;
- subscribe to events;
- list agents;
- send agent message;
- list extensions;
- install extension;
- fork extension;
- reload extension;
- list env vars;
- set env var;
- set theme;
- resolve app reference;
- create annotation;
- list annotations;
- inspect source for reference;
- inspect fibers for reference;
- trigger build;
- read build status;
- subscribe to build events;
- request permission.

All state-changing RPC calls should result in durable events. RPC should expose both commands and observation streams, so external agents can understand not only current state but how that state came to be.

### 7.4 Runtime And Build Control Channels

The app needs two related but distinct control channels:

- **Runtime control socket**: observes and controls the running app, including windows, panels, commands, tasks, chats, documents, themes, events, and annotations.
- **Build control socket**: observes and controls the live build environment, including Vite/HMR status, extension compilation, source graph traversal, generated files, diagnostics, and reloads.

Both channels should be available to agents. The split keeps operational app control and build-system control clear, while still making production and development feel like the same live environment.

## 8. Extension System

The extension model should feel like composing app primitives, not installing isolated plugins. More strongly: everything above the protected runtime is an extension. Bundled panels and tools use the same extension SDK that user-created panels use.

### 8.1 Extension Manifest

Every extension should define:

- ID;
- name;
- version;
- entry points;
- panels;
- commands;
- agents;
- services;
- requested permissions;
- env requirements;
- persistence requirements;
- event schemas it emits;
- read models it contributes;
- fork lineage when derived from another extension;
- optional chat/top-row buttons and flows it contributes;
- source/deixis metadata for rendered UI and commands.

### 8.2 Extension Source Layout

User extensions live under the workspace-local `/.plastic/extensions` folder. The loader should support both single-file and folder-based extensions:

```text
.plastic/
  extensions/
    quick-note.tsx
    review-panel/
      plastic.extension.json
      index.tsx
      main.ts
      styles.css
      components/
        ReviewList.tsx
```

Supported forms:

- single `.tsx` file for fast panel experiments;
- single `.ts` file for command/service-only extensions;
- folder with `index.tsx` for panel UI;
- folder with `main.ts` for commands, services, agents, or scheduled work;
- optional manifest for metadata, permissions, event schemas, buttons, and read models.

Vite should compile and hot-reload these extensions in real time. The app should surface compile/runtime errors in a panel that agents can inspect and fix.

Extensions should automatically participate in the deixis layer. A `.tsx` single-file panel should still be pointable, commentable, traceable to source, and inspectable by an agent.

### 8.3 Extension Runtime

Open question: whether extension command code runs in renderer, isolated preload, utility process, worker, or a separate Node process.

Initial recommendation:

- extension UI starts as HTML/CSS/TypeScript mounted by the renderer shell;
- extension command logic runs in an isolated host process or worker;
- communication goes through typed RPC only;
- protected runtime owns permissions, event durability, and lifecycle.

### 8.4 Binary User Extensibility

Users with only the packaged binary should be able to:

- create extension files in `/.plastic/extensions`;
- add TypeScript source;
- define a manifest;
- have the app compile or load it;
- hot-reload changes;
- grant permissions interactively;
- fork a bundled extension into user space.

This implies the binary may need to include or download a local extension toolchain, or support loading prebuilt extension bundles.

### 8.5 Source User Extensibility

Users building from source can:

- modify runtime-adjacent services;
- add bundled default extensions;
- change default layouts;
- change runtime behavior outside immutable recovery boundaries.

## 9. Protected Immutable Runtime

The protected runtime should provide a safe baseline that extensions cannot permanently break. It is not a first-party product surface. It is the minimum substrate needed to boot, recover, preserve event integrity, load extensions, and expose the control plane.

Protected responsibilities:

- boot;
- workspace loading;
- window registry;
- panel registry;
- extension loader;
- permission manager;
- recovery mode;
- bundled extension discovery;
- RPC control plane;
- runtime control socket;
- build control socket;
- local event store;
- event replay;
- rewind and snapshot machinery;
- settings/env management;
- source/deixis index;
- fiber/runtime inspection hooks;
- extension disable/remove flow.

The immutable runtime can still be open source, but packaged builds should preserve a recovery path even if user extensions are broken. Chat, documents, tasks, and other batteries-included experiences are bundled extensions, not privileged products.

## 10. Hot Reload

Hot reload is a product feature.

Requirements:

- extension file watcher;
- Vite-backed rebuild/recompile on change;
- HMR for extension panels where possible;
- validate manifest and schemas;
- preserve extension state when possible;
- remount changed panel;
- show build/runtime errors in a developer-facing panel;
- let agents inspect errors and propose fixes;
- allow rollback to last working extension version;
- record extension lifecycle events so a user or agent can understand exactly when behavior changed.
- expose build state through the build control socket.

## 11. Security And Permissions

Because agents and extensions can control the app, permissions need to be first-class.

Permission examples:

- read workspace state;
- read event stream;
- append events;
- modify workspace state;
- rewind or branch workspace;
- create panels;
- execute commands;
- access filesystem paths;
- access network;
- read sensitive env vars;
- spawn processes;
- control other agents;
- install extensions;
- fork bundled extensions;
- add buttons or flows to existing panels;
- change themes and global UI settings;
- inspect source/deixis metadata;
- inspect fibers and running tasks;
- trigger builds or modify extension source.

Permission UX:

- human-readable grant prompts;
- durable grants scoped by extension/agent/workspace;
- revocation panel;
- event log for privileged actions;
- recovery mode that can disable all user extensions and restore from event history.

## 12. Initial Architecture

Proposed process layout:

- **Electron main**: boot, windows, protected runtime services, event store, extension supervisor, external RPC server.
- **Runtime control socket**: external and internal agents observe/control the running app.
- **Build control socket**: agents observe/control Vite, HMR, extension compilation, diagnostics, and source graph operations.
- **Preload**: narrow bridge from renderer to internal RPC.
- **Renderer**: shell UI, horizontal infinite panel layout, HTML/CSS panel projections, extension panel host.
- **Extension host**: isolated runtime for extension commands/services.
- **Agent host**: internal agent runtime and adapter layer to external agents via ACP or provider SDKs.

Proposed package layout:

```text
apps/desktop/
  src/main/
  src/preload/
  src/renderer/
packages/core/
  src/workspace/
  src/windows/
  src/panels/
  src/commands/
  src/event-store/
  src/read-models/
  src/documents/
  src/chats/
  src/tasks/
  src/agents/
  src/deixis/
  src/env/
  src/permissions/
packages/rpc/
packages/effect-runtime/
packages/build-control/
packages/extension-sdk/
packages/extension-host/
packages/agent-sdk/
packages/agent-adapters/
extensions/
  bundled/chat/
  bundled/documents/
  bundled/tasks/
  examples/
.plastic/
  extensions/
docs/
```

## 13. Early Implementation Milestones

### Milestone 0: Planning And Skeleton

- Write planning doc.
- Choose package manager.
- Scaffold TS monorepo.
- Add Electron + Vite app.
- Add Effect dependencies.
- Establish lint, format, test, typecheck.

### Milestone 1: Protected Runtime And Event Store

- Boot Electron app.
- Add local append-only event store.
- Add typed event schemas.
- Add replay into read models.
- Add snapshot and basic rewind mechanics.
- Add protected runtime recovery path.
- Add basic runtime/build socket separation.

### Milestone 2: Extension-Based Shell

- Add multi-window registry.
- Add named panel registry.
- Load bundled Chat, Document, and Tasks extensions.
- Render panels using HTML/CSS/TypeScript projections in a left-to-right horizontal workspace.
- Persist layout through events.
- Add app event subscription stream.

### Milestone 3: Typed Commands And Internal RPC

- Define command registry.
- Define Effect services for panels, documents, chats, tasks, and events.
- Expose typed internal RPC to renderer.
- Let the UI list and execute commands.
- Ensure every durable command appends events.

### Milestone 4: Agents As App Citizens

- Add agent registry.
- Add chat messages with agent identity.
- Add command execution by agent.
- Add event subscriptions for agents.
- Add permission checks.
- Add first Codex adapter through ACP or SDK.
- Allow an agent to change theme through RPC.
- Allow an agent to create a chat-injection button through RPC.

### Milestone 5: External Control Plane

- Add localhost RPC server.
- Provide a small CLI/client.
- Allow external agent/process to list panels, create tasks, edit docs, and subscribe to events.

### Milestone 6: Extension Panels

- Define extension manifest.
- Load local extensions from `/.plastic/extensions`.
- Support single-file `.tsx` extensions and folder extensions.
- Mount an extension panel.
- Register extension commands.
- Hot-reload extension UI through Vite.
- Expose build diagnostics through the build control socket.

### Milestone 7: Agent Builds A Panel

- User asks agent for a new panel.
- Agent writes extension files.
- App builds and loads the extension.
- User grants required permissions.
- New panel appears and can observe/control primitives.

### Milestone 8: Learned Buttons And Flows

- Add chat panel top-row button registry.
- Let extensions, agents, and crons propose buttons.
- Add a recurring task that analyzes recent events.
- Let that recurring task propose a useful button or flow overnight.

### Milestone 9: Deixis And Self-Building

- Add metadata from visible UI elements to panel/extension/source/event/command references.
- Let users annotate any panel element.
- Let agents resolve annotations into source and runtime references.
- Add source traversal from UI element to extension or bundled source.
- Add Effect fiber/task inspection for commands, agent runs, schedulers, and builds.
- Let an agent modify the pointed-at extension and reload it through the build control socket.

## 14. Key Open Questions

- How should extension code be sandboxed while still feeling powerful?
- How should event store snapshots, branches, and rewinds be represented in the UI?
- Should the event store be backed by SQLite, JSONL, an embedded log library, or a hybrid?
- How much of Effect RPC should be adopted directly versus a small custom typed RPC layer?
- How should Vite HMR be isolated for user extensions while preserving fast feedback?
- What is the exact protocol split between runtime control socket and build control socket?
- How should UI-to-source-to-fiber metadata be represented without making extension authors do too much manual work?
- How should comments on UI elements behave when the source or panel changes?
- Should external agents authenticate through a local token, OS keychain approval, or per-session pairing?
- What should the recovery mode UI expose?
- How should the binary support TypeScript extension building: bundled esbuild, embedded toolchain, or prebuilt bundles only?
- Which ACP or SDK surface should the first Codex adapter target?

## 15. Near-Term Decisions To Make

- Package manager: `pnpm` is the likely default for a TS monorepo.
- Renderer approach: HTML/CSS plus small TypeScript controllers. No React initially.
- Extension bundler: Vite.
- Persistence: append-only local event store first, with optional SQLite read models.
- External RPC transport: localhost HTTP/WebSocket first.
- Runtime/build control: two local ports or sockets from the beginning.
- Document model: Markdown editor and preview first.
- Chat model: Markdown chat transcript first.
- Tasks model: normal tasks plus recurring tasks/crons from the first useful version.
- Agent integration: Codex first, via ACP or SDK depending on the most stable app-server surface.
- Extension location: workspace-local `/.plastic/extensions`.
- Layout model: horizontal infinite scroll with multi-window support.
- Deixis model: stable metadata on rendered elements, durable annotations, and source/fiber traversal.

## 16. Definition Of A Successful First Prototype

A successful first prototype should let a user:

1. Open the Electron app.
2. See Chat, Document, and Tasks panels.
3. Understand that those panels are bundled extensions that can be forked.
4. Add panels to the right in a horizontal scrolling workspace.
5. Create a task, including a recurring task, and edit a Markdown document.
6. Chat with an agent through a Markdown chat view.
7. Expand the chat top row and see buttons/flows contributed by extensions or agents.
8. See durable events generated from those actions.
9. Rewind to a meaningful previous app state.
10. Open a second window on the same project with different panels.
11. Have panels communicate across windows through RPC/events.
12. Tell an agent to turn the app to dark mode and watch all windows update.
13. Tell an agent to add a chat button that injects a user message and see it appear immediately.
14. Point at something in the app, comment on it, and have an agent resolve that reference to source/runtime context.
15. Connect an external script over RPC and list/control panels.
16. Connect a Codex-backed agent adapter.
17. Add a simple extension panel from `/.plastic/extensions`.
18. Change extension source and see the panel hot-reload.
19. Ask an agent to scaffold a new panel extension.
20. Run a cron that learns from recent usage and proposes a new button or flow.

The prototype does not need to solve every security and sandboxing issue, but its architecture should make those issues explicit and progressively hardenable.
