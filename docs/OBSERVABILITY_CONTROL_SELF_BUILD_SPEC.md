# Observability, Control, And Self-Build Spec

## Purpose

This spec defines the next three infrastructure milestones for Plastic:

1. Normalize all workspace identity to Plastic.
2. Make the Plastic control bus reachable by every agent through a native bridge.
3. Make Plastic observable enough to build itself, then expose a verified self-build loop.

The goal is not more surface area. The goal is a closed empirical loop:

```text
observe -> decide -> act -> reload -> verify -> record
```

An agent outside Plastic must be able to drive that loop. An agent inside a Plastic panel must be able to drive the same loop through the same public capabilities. Plastic prod and Plastic dev should differ only by environment and permissions, not by hidden control paths.

## Global Invariants

- **One identity**: the product, runtime directories, docs, manifests, env vars, and event payloads use `plastic` / `Plastic`. Legacy workspace naming is not used for current runtime paths or new extension contracts.
- **One durable history**: every meaningful app, agent, build, panel, extension, and verification action is appended to the Plastic event stream.
- **One method registry**: every transport calls the same Plastic RPC method registry. HTTP, MCP, Electron IPC, future sockets, and internal calls are adapters, not separate APIs.
- **One discovery surface**: agents learn capabilities from `plastic/state`, `plastic/methods`, and `plastic/snapshot`; they do not rely on private knowledge when the runtime can describe itself.
- **Transport independence**: if an agent cannot use HTTP because of sandbox networking, it must have an equivalent native bridge that reaches the same registry and produces the same durable events.
- **Observable before mutable**: any new control capability must also expose enough state, lineage, and validation signals for an agent to know whether it worked.
- **Empirical completion**: a task is not complete until Plastic can prove it through RPC-visible state, event history, and, for UI changes, a screenshot or DOM/ref check.
- **No hidden first-party privilege**: bundled panels and workflows use the same primitives as user extensions unless explicitly part of the protected recovery runtime.

## Part 1: Plastic Workspace Identity

### Scope

Normalize the current runtime identity to Plastic:

- workspace-local runtime directory: `.plastic`
- event store: `.plastic/events/events.jsonl`
- extension directory: `.plastic/extensions`
- manifest name preference: `plastic.extension.json`
- docs, comments, generated examples, user-facing text, env vars, and source constants should say Plastic.

Backward compatibility is not required for this fresh project. If old workspace data exists during development, a one-time migration may be useful, but the canonical path is `.plastic`.

### Invariants

- Runtime code creates and reads `.plastic`.
- Extension scanning reads from `.plastic/extensions`.
- Newly scaffolded extensions use `plastic.extension.json`.
- `plastic/snapshot`, `build/status`, and `plastic/state` report `.plastic` paths.
- New events use Plastic terminology except when explicitly referring to historical migration.
- Docs describe Plastic as the product and `.plastic` as the local workspace directory.

### Empirical Validation

Run the app and verify:

- `build/status` returns `plasticDir`, pointing to `.plastic`.
- `plastic/snapshot` reports event and extension paths under `.plastic`.
- Creating/scanning an extension under `.plastic/extensions` works.
- Searching for legacy workspace names has no current-contract hits, only allowed historical notes if any are intentionally retained.
- The event store continues to append and replay after the rename.

## Part 2: Universal Plastic Control Bus

### Scope

Plastic already has an HTTP RPC bus. The missing capability is universal reachability from agents embedded inside Codex chat panels.

Add a native bridge named `plastic_rpc`, initially through MCP because the installed Codex app-server supports MCP tools while its generated schema does not include `dynamicTools`.

`plastic_rpc` input:

```ts
{
  method: string;
  input?: object;
}
```

`plastic_rpc` output:

```ts
{
  ok: boolean;
  value?: unknown;
  error?: string;
}
```

The bridge calls the same Plastic method registry as `POST /rpc`. It is a transport adapter only.

### Invariants

- Every successful `plastic_rpc` call is equivalent to calling `POST /rpc` with the same `{ method, input }`.
- Bridge calls are durably observable as events, including caller identity when available, method, input summary, success/failure, and correlation IDs.
- `plastic_rpc` can call `plastic/state` and `plastic/methods`.
- `plastic_rpc` can create panels, create chats, send chat turns, change theme, inspect visible refs, and run self-tests.
- Agents are instructed to call `plastic/state` before guessing ids or methods.
- No autonomous proof may rely on shell `curl` from inside a chat panel.
- The bridge is registered before starting a Codex chat thread that is expected to use Plastic controls.
- If a bridge transport is unavailable, `plastic/selfTest` or a dedicated bus test reports the failure explicitly.

### Empirical Validation

The required proof:

1. External controller calls `chats/createCodexChat` to create Chat A.
2. External controller sends Chat A a prompt requiring native `plastic_rpc`.
3. Chat A calls `plastic_rpc` with `plastic/state`.
4. Chat A calls `plastic_rpc` with `chats/createCodexChat` to create Chat B.
5. Chat A calls `plastic_rpc` with `chats/sendToCodex` targeting Chat B.
6. Chat B receives the turn and replies.

Pass conditions:

- `events/list` shows Chat A and Chat B creation events.
- `events/list` shows bridge call events for `plastic/state`, `chats/createCodexChat`, and `chats/sendToCodex`.
- `chats/getBinding` returns bound Codex threads for both chats.
- Chat B has a `chat.user_message.submitted` event caused by Chat A's bridge call.
- Chat B has a completed agent response.
- The proof can be repeated after app restart.

## Part 3: Canonical Observability And Self-Build Loop

### Scope

Plastic needs one canonical observability contract and one verified build loop.

Observability methods:

- `plastic/state`: HATEOAS app state and actions.
- `plastic/methods`: all callable methods, schemas, owners, permissions.
- `plastic/snapshot`: high-signal runtime snapshot for agents.
- `deixis/listVisibleRefs`: visible UI references.
- `deixis/resolveRef`: source/event/action lineage for a visible ref.
- `windows/screenshot`: full window or ref-specific visual proof.
- `plastic/selfTest`: fast health and capability checks.

Self-build methods should eventually expose:

- extension scaffold/write/read/list;
- source-aware file edits for `.plastic/extensions` and allowed dev source;
- extension scan/register/reload;
- renderer reload;
- typecheck/build/test execution;
- screenshot and DOM assertions;
- result recording into events.

### Invariants

- `plastic/snapshot` is sufficient for an agent to answer: what exists, what is visible, what methods are callable, what is running, what recently changed, and what can be done next.
- Every visible interactive element has a stable `data-plastic-ref`.
- `deixis/resolveRef` maps visible refs to panel id, extension id when available, command/method when available, source hints, recent event lineage, and possible actions.
- `windows/screenshot` can capture the whole app and a specific visible ref.
- `plastic/selfTest` checks event store, method registry, projections, extension scan, visible refs, build status, Codex status, bus status, and bridge status.
- Self-build actions write durable events for request, execution, output, success/failure, and verification.
- A generated or modified extension is not considered complete until it is visible, inspectable, and verified.
- Build/test failures are first-class state, not terminal noise only.

### Empirical Validation

The required self-build proof:

1. Use Plastic RPC to scaffold a new extension under `.plastic/extensions`.
2. Scan/register the extension through Plastic RPC.
3. Create or mount its panel through Plastic RPC.
4. Reload or hot-update the renderer.
5. Verify the panel exists in `panels/list`.
6. Verify the panel has visible refs in `deixis/listVisibleRefs`.
7. Capture the panel with `windows/screenshot`.
8. Run `plastic/selfTest`.
9. Run typecheck/build through the build loop or terminal until exposed as RPC.
10. Append a durable verification event that includes pass/fail, method outputs, and screenshot metadata.

Pass conditions:

- The extension appears without hand-editing app runtime code.
- The panel is visible and addressable by ref.
- The screenshot is non-empty and targets the expected panel.
- `plastic/selfTest` passes or reports precise actionable failures.
- Typecheck/build passes.
- Replaying events reconstructs the panel and extension state.

## Implementation Order

1. Normalize workspace identity to Plastic.
2. Build and prove `plastic_rpc` through MCP.
3. Upgrade `plastic/snapshot`, `deixis/resolveRef`, and `plastic/selfTest` to cover the bridge and visible refs.
4. Add the extension self-build loop.
5. Use the loop to build the next Plastic panel from inside Plastic.

## Definition Of Done

This plan is done when:

- no current runtime contract uses legacy workspace naming;
- a Codex chat agent can control Plastic through `plastic_rpc`;
- an external agent and an internal chat agent can both complete the same create-chat/message-chat proof;
- an agent can inspect the current UI, resolve refs to source/event lineage, and capture screenshots through RPC;
- an agent can create, mount, verify, and record a new extension panel using Plastic-controlled steps.
