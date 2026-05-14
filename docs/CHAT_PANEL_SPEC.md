# Chat Panel Product Spec

## Purpose

Plastic chat panels should become full agent conversation surfaces, not thin text boxes. A chat panel is the human-facing projection of one or more agent sessions, backed by the shared Plastic event stream and controlled through public RPC. The first runtime is Codex app-server, but the panel must stay runtime-neutral: Codex is an agent backend behind the same primitives that future agents use.

The bar is "ChatGPT-like chat inside any panel": a durable transcript, strong composer, streaming agent output, tool/activity rendering, turn controls, conversation history, attachments, and clear state. Plastic adds one extra requirement: every meaningful chat action is inspectable, addressable, replayable, and controllable by agents.

## Current State

The current chat panel has the first pieces in place:

- two chat panels can exist beside each other in the horizontal workspace;
- the composer is anchored at the bottom of the panel;
- user messages can be submitted to Codex through `chats/sendToCodex`;
- Codex app-server is spawned over `stdio://`;
- `initialize`, `thread/start`, and `turn/start` are wired;
- `item/agentMessage/delta`, `item/completed`, and `turn/completed` are projected into chat events;
- panel-to-panel mailbox messages render as peer messages;
- visible chat UI has `data-plastic-ref` hooks and can be screenshotted through `windows/screenshot`.

The current implementation is useful but too narrow:

- chat events flatten Codex items into `chat.agent_message.*` rather than preserving the Codex thread/turn/item model as first-class read state;
- there is no complete transcript model for user messages, agent messages, reasoning summaries, commands, file changes, approvals, errors, token usage, or plans;
- `chats/sendToCodex` is an opinionated helper instead of a thin passthrough plus durable binding;
- raw Codex notifications are recorded, but the chat panel does not render most of them;
- there is no explicit active turn state, stop button, retry, edit/resend, branch, clear, resume, or thread selector;
- attachments, images, local files, and pasted context are not represented in the composer;
- model, reasoning effort, cwd, permissions, collaboration mode, and environment controls are not available per panel;
- chat scroll, keyboard behavior, and Markdown rendering need to reach normal chat-app expectations.

## Design Principles

- **Codex-native passthrough**: expose Codex app-server methods directly and preserve their response/notification shapes. Plastic can add convenience methods, but those should compose raw primitives rather than hide them.
- **Durable semantic stream**: write every meaningful user action, backend request, backend notification, server request, approval decision, and UI command into Plastic events.
- **Projection, not private state**: the chat UI renders from derived state over Plastic events plus Codex-native thread/item records.
- **Panel-local but cross-panel capable**: each chat panel has its own session binding, model config, cwd, and active turn, while any panel or agent can message or inspect any other panel through RPC.
- **Extensible by construction**: chat controls, renderers, item cards, slash commands, prompt flows, and composer tools are extensions, not privileged code paths.
- **Deixis everywhere**: messages, turns, tools, diffs, approvals, files, and composer attachments are all addressable with stable refs.

## Required User Experience

### Panel Header

Each chat panel needs a compact header that shows:

- chat title and editable name;
- agent runtime and backend status;
- model and reasoning effort;
- cwd/project binding;
- active thread id and turn state;
- connection state, pending requests, and error state;
- actions menu for thread/session operations.

Essential actions:

- connect or reconnect backend;
- start new thread;
- resume existing thread;
- fork thread;
- rename thread;
- archive thread;
- clear visible session by starting a replacement thread;
- open raw thread inspector;
- open related document/task/panel.

### Transcript

The transcript should look and behave like a mature chat surface:

- user messages aligned right, agent/system/tool items aligned left;
- Markdown rendering for user and agent text;
- code blocks with copy controls;
- streaming text updates without scroll jumps;
- stable auto-scroll only when the user is already near the bottom;
- "jump to latest" affordance when the user has scrolled up;
- timestamps and sender identity available but visually quiet;
- per-message actions: copy, quote/reply, edit, resend, inspect event, inspect source/ref;
- message grouping by turn;
- clear in-progress, completed, failed, interrupted, and stale-thread states;
- empty state that invites use without explanatory clutter.

The transcript must render more than text. It should support cards for:

- reasoning summaries;
- plans and plan updates;
- shell commands with live output;
- file changes and diffs;
- MCP/tool calls;
- web searches;
- image views;
- context compaction;
- model reroutes and verification notices;
- errors and retryable failures;
- approval requests and their final decisions.

### Composer

The composer should support:

- fixed bottom placement;
- Enter to send, Shift+Enter for newline;
- multiline auto-grow up to a max height;
- disabled/sending states;
- stop button while a turn is active;
- steer button or same composer behavior for active steerable turns;
- paste text, images, and files;
- attach local files/images;
- mention panels, files, tasks, docs, events, methods, and refs;
- slash commands or command palette integration;
- model/effort/cwd selectors;
- visible target agent/runtime selector;
- optional "send to panel" target for panel mailbox messages;
- local draft persistence per panel.

The composer output should map to Codex app-server `turn/start` or `turn/steer` input items without lossy conversion. Text, image, and local image items should be represented as native input content where the backend supports them.

### Turn Controls

The panel should expose:

- active turn indicator;
- stop/interrupt;
- retry last user turn;
- edit and resend from a prior user message;
- steer active turn when allowed;
- compact conversation;
- rollback last N turns where supported;
- clean background terminals;
- review mode entry when relevant;
- show/hide activity items.

### Approvals And Server Requests

Codex app-server can issue server-initiated JSON-RPC requests during a turn. Plastic must not ignore these.

Required approval/request surfaces:

- command execution approval;
- file change approval;
- permissions request;
- MCP elicitation;
- tool user input request;
- dynamic tool call request;
- attestation generation if enabled later.

Each request should render inline in the active turn, with durable events for request received, user decision, response sent, and server resolution. The app should keep v0 permissive if desired, but the UI/event model must represent the approval lifecycle because future modes need it.

## Codex App-Server Contract

The Codex adapter should be reorganized around pure passthrough plus bindings.

### Raw Passthrough Methods

Plastic should expose one stable generic method:

- `codex/request`: `{ method, params } -> result`

And convenience aliases that do not change protocol shape:

- `codex/threadStart` -> `thread/start`
- `codex/threadResume` -> `thread/resume`
- `codex/threadFork` -> `thread/fork`
- `codex/threadList` -> `thread/list`
- `codex/threadRead` -> `thread/read`
- `codex/threadArchive` -> `thread/archive`
- `codex/threadNameSet` -> `thread/name/set`
- `codex/turnStart` -> `turn/start`
- `codex/turnSteer` -> `turn/steer`
- `codex/turnInterrupt` -> `turn/interrupt`
- `codex/modelList` -> `model/list`
- `codex/configRead` -> `config/read`

These methods should pass parameters through as-is, return app-server results as-is, and record request/response envelopes in Plastic events.

### Chat Binding Methods

Plastic-specific methods should only bind Codex entities to Plastic panels:

- `chats/bindCodexThread`: bind `{ chatId, threadId, runtimeId }`;
- `chats/getBinding`: return current binding and derived active turn state;
- `chats/startCodexThread`: call `thread/start`, bind result to panel, record both raw and binding events;
- `chats/send`: high-level user action that records a Plastic user message and then calls `turn/start` or `turn/steer` using native Codex params;
- `chats/interrupt`: call `turn/interrupt` for the active turn;
- `chats/resumeThread`: call `thread/resume`, bind result;
- `chats/forkThread`: call `thread/fork`, create/bind a new panel or replace binding based on input.

The high-level methods exist for UI ergonomics, but the chat panel should also be able to drive itself entirely through raw `codex/request`.

### Notification Mapping

Every app-server notification should be stored durably:

- raw event: `codex.notification.received` with `{ method, params }`;
- specialized event: `codex.thread.started`, `codex.turn.started`, `codex.item.started`, etc.;
- chat projection event only when useful for backward-compatible/simple UI.

Preferred durable model:

- `codex.thread.*` events preserve full thread payloads;
- `codex.turn.*` events preserve full turn payloads;
- `codex.item.*` events preserve full item payloads;
- `codex.item.delta.*` events preserve item deltas;
- derived read model reconstructs current transcript.

The chat renderer should consume the derived read model, not ad hoc event matching inside `renderer/main.ts`.

### Generated Types

The adapter should generate TypeScript schemas from the local Codex binary:

```bash
codex app-server generate-ts --out apps/desktop/src/generated/codex-app-server
codex app-server generate-json-schema --out apps/desktop/src/generated/codex-app-server-schema
```

Generated artifacts should not become hand-edited protocol truth. The adapter should use them to type raw requests, notifications, item unions, and thread/turn state.

## Plastic Chat Read Model

Introduce a chat read model in core, derived from events:

```ts
interface ChatSession {
  chatId: string;
  runtimeId: string;
  backend: "codex" | string;
  threadId: string | null;
  title: string;
  cwd: string | null;
  model: string | null;
  reasoningEffort: string | null;
  status: "idle" | "connecting" | "ready" | "running" | "failed";
  activeTurnId: string | null;
  messages: ChatMessageView[];
  turns: ChatTurnView[];
  pendingRequests: ChatServerRequestView[];
}
```

Message/item views should preserve source identity:

```ts
interface ChatMessageView {
  id: string;
  chatId: string;
  source: "plastic" | "codex" | "panel-mailbox";
  sourceEventIds: string[];
  role: "user" | "agent" | "system" | "peer" | "tool";
  content: Array<ChatContentBlock>;
  status: "pending" | "streaming" | "completed" | "failed" | "interrupted";
  threadId?: string;
  turnId?: string;
  itemId?: string;
}
```

This read model should become the renderer input for chat panels. The renderer should stop rebuilding chat state manually from raw events.

## Event Requirements

Add or standardize events:

- `chat.session.created`
- `chat.session.bound`
- `chat.session.configured`
- `chat.user_message.drafted`
- `chat.user_message.submitted`
- `chat.user_message.edited`
- `chat.turn.requested`
- `chat.turn.interrupted`
- `chat.turn.retried`
- `chat.thread.forked`
- `chat.thread.resumed`
- `chat.server_request.received`
- `chat.server_request.responded`
- `chat.attachment.added`
- `chat.attachment.removed`

For Codex specifically:

- `codex.request.sent`
- `codex.response.received`
- `codex.request.failed`
- `codex.notification.received`
- `codex.thread.started`
- `codex.thread.resumed`
- `codex.thread.forked`
- `codex.thread.read`
- `codex.thread.status_changed`
- `codex.turn.started`
- `codex.turn.completed`
- `codex.turn.diff_updated`
- `codex.turn.plan_updated`
- `codex.item.started`
- `codex.item.completed`
- `codex.item.agent_message_delta`
- `codex.item.command_output_delta`
- `codex.item.reasoning_summary_delta`
- `codex.server_request.received`
- `codex.server_request.responded`
- `codex.server_request.resolved`

## RPC Requirements

Chat must be fully controllable over RPC:

- list chat sessions;
- get chat session;
- create chat panel/session;
- configure chat session;
- bind/unbind backend thread;
- send message;
- steer active turn;
- interrupt active turn;
- retry turn;
- edit/resend message;
- attach file/image;
- list transcript items;
- inspect source event for any message/item;
- screenshot panel/transcript/item/composer;
- focus composer;
- set draft;
- submit draft;
- toggle action strip;
- jump to latest.

These are not all first implementation tasks, but they define the target surface agents should be able to drive.

## Immediate Improvement Plan

### Phase 1: Codex Passthrough Foundation

- Add missing passthrough methods for `thread/resume`, `thread/fork`, `thread/list`, `thread/read`, `thread/name/set`, `turn/steer`, `turn/interrupt`, `model/list`, and `config/read`.
- Record `codex.request.sent`, `codex.response.received`, and `codex.request.failed`.
- Change notification recording from method-name-derived events only to a raw `codex.notification.received` event plus specialized projections.
- Add support for server-initiated requests and responses in the JSON-RPC transport.
- Generate and wire Codex app-server TypeScript types.

### Phase 2: Chat Read Model

- Move chat transcript projection from `apps/desktop/src/renderer/main.ts` into `packages/core`.
- Preserve Codex thread/turn/item identity in the read model.
- Render `item/started`, `item/completed`, and deltas generically by item type.
- Track active turn, pending server requests, and token/status updates.
- Keep panel mailbox messages as peer messages in the same transcript.

### Phase 3: Canonical Chat UX

- Add Markdown renderer and code block copy controls.
- Add stop button while a turn is active.
- Add model, effort, cwd, and thread controls in the panel header.
- Add jump-to-latest behavior.
- Add message actions: copy, inspect, edit/resend, retry.
- Add turn item cards for commands, diffs, plans, reasoning summaries, and errors.
- Add inline approval cards.

### Phase 4: Attachments And Deixis

- Add file/image paste and attach.
- Add mention picker for panels, refs, files, docs, tasks, events, and methods.
- Add stable refs for every message, item, turn, approval, and attachment.
- Add source traversal from message/item to event, Codex notification, source file, and renderer component.

## Open Decisions

- Whether a chat panel maps to exactly one backend thread at a time or can display multiple bound threads.
- Whether panel-to-panel mailbox messages should appear in the same transcript or in a separate "ambient messages" lane.
- Whether `chats/send` should default to `turn/steer` when a turn is active and steerable, or require an explicit user choice.
- Whether generated Codex protocol artifacts should be committed or generated during setup.
- Whether v0 approval requests should auto-accept under the fully permissive policy while still rendering the lifecycle, or pause for user choice immediately.

## Acceptance Criteria For "Real Chat Panel v1"

- A user can open a chat panel, choose cwd/model/effort, send a message, watch streaming output, stop the turn, and retry/edit.
- The panel can resume or fork a Codex thread.
- Commands, diffs, plans, errors, and approvals render as structured transcript items.
- All transcript items have stable refs and can be inspected through deixis.
- An external agent can drive the full flow through RPC with no private UI-only state.
- The app-server adapter can pass through basic Codex features without Plastic-specific lossy wrappers.
- `pnpm typecheck`, `pnpm build`, `plastic/selfTest`, and `windows/screenshot` are part of verification for chat changes.
