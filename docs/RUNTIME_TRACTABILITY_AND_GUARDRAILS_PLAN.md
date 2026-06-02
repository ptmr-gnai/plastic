# Runtime Tractability And Guardrails Plan

Last updated: 2026-06-02

This plan captures the next architecture focus after getting both Electron and headless Plastic running. The goal is to make Plastic easier for agents to reason over, observe, control, and safely change while preserving the original vision: a protected runtime plus an extension substrate where everything user-facing can be forked, modified, and recomposed.

## Current State

Plastic now has two viable runtime shapes:

- Electron runtime: GUI shell, browser windows, screenshots, visible refs, Codex app-server integration, runtime RPC on `7331`, build RPC on `7332`.
- Headless runtime: Node-only fallback for RPC/event/extension validation when Electron or windowing is unavailable.

Both runtimes use the same durable event stream and can project the same state. This is an important validation of the substrate: GUI and headless are runtime embodiments of the same evented workspace, not separate products.

The extension migration has real footholds:

- Bundled extension manifests are disk-backed.
- Chat has an extension-owned renderer module.
- Renderer selection is manifest-driven.
- Workspace renderer modules can render panels.
- Bundled chat can be forked into `.plastic/extensions/chat-fork`.
- Forked chat can be modified without editing protected renderer core.

## Remaining "Everything Is An Extension" Work

The remaining work is not mainly about manifests. It is about making extension ownership true at runtime.

### 1. Extension Method Handlers

Current issue: extension manifests can declare methods, but handler implementations still mostly live in protected runtime code.

Target:

- Extension manifests declare method handler modules or exported handler ids.
- Runtime loads and registers extension methods with owner `{ kind: "extension", id }`.
- Handlers receive typed services: event append, projections, RPC call, workspace paths, and extension metadata.
- Broken handlers cannot prevent runtime boot, method listing, extension recovery, or generic rendering.

Success:

- A workspace extension defines a method in its own module.
- `plastic/methods` exposes the method with extension ownership.
- Calling the method writes a durable event and updates projected state.
- Breaking the handler leaves the runtime usable and reports recovery metadata.

### 2. Extension Lifecycle

Current issue: scan, register, fork, edit, reload, and verify are separate manual operations.

Target methods:

- `extensions/reload`
- `extensions/verify`
- `extensions/enable`
- `extensions/disable`
- `extensions/unload`
- `extensions/recover`
- `extensions/buildStatus`

Success:

- An agent can fork an extension, edit it, reload it, verify UI/state, and recover from failure through RPC alone.
- `plastic/state` advertises lifecycle actions per extension.
- Lifecycle events are durable and replayable.

### 3. Shared Runtime Kernel

Current issue: Electron and headless runtimes duplicate behavior. Electron main is too large, and headless was intentionally built as a retreat rather than a clean shared architecture.

Target:

- Extract a `runtime-kernel` module used by both Electron and headless.
- Kernel owns event store, method registry, extension scan/load, projections, and core runtime methods.
- Electron owns windowing, screenshots, visible refs, IPC, and shell-specific methods.
- Headless owns only HTTP RPC/SSE and optional static serving.

Success:

- Core methods are registered once.
- Electron and headless expose equivalent core method behavior.
- New extension/lifecycle work lands in one place.

### 4. Bundled Surface Migration

Current issue: chat moved furthest, but document, tasks, Codex, and agent-dev are still mostly protected renderer/runtime code.

Target:

- Each bundled surface has an extension-owned renderer.
- Product-specific HTML leaves protected renderer core.
- Runtime provides primitives and backend capabilities, not first-party app surfaces.

Success:

- Protected renderer shell only resolves panels, invokes renderers, and hosts recovery UI.
- Bundled and workspace surfaces use the same renderer contract.

### 5. Chat Boundary Cleanup

Current issue: chat renderer is extension-owned, but chat behavior is mostly runtime-owned.

Target:

- Chat extension owns the chat surface contract.
- Codex adapter exposes backend capability methods.
- Chat calls backend capability methods through RPC.
- Alternate chat renderers can render the same chat state.

Success:

- `plastic.chat` can be forked and customized without relying on hardcoded bundled ids.
- Chat read model, buttons, compose behavior, and Codex binding are explicit contracts.

### 6. Deixis To Source

Current issue: visible refs exist, but they do not consistently resolve to extension source and next actions.

Target:

`deixis/resolveRef` should return:

- window id
- panel id
- extension id
- renderer id
- manifest path
- renderer source path
- source span where practical
- method/action behind the visible UI
- recent event lineage
- available edit/reload/verify actions

Success:

- An agent can point at a button, message, compose box, panel body, or extension surface and learn what code owns it.
- The same works for bundled and workspace extensions.

## Code Smells To Address

### God File: Electron Main

`apps/desktop/src/main/main.ts` currently mixes:

- event store boot;
- method registration;
- Electron windows;
- screenshots;
- visible refs;
- build control;
- Codex adapter wiring;
- chat projections;
- extension operations;
- deixis.

This makes change risk hard to localize. New runtime behavior should move into focused modules before this file grows further.

### Runtime Duplication

Headless and Electron currently duplicate some method registration and projection behavior. This should be paid down quickly by extracting a shared runtime kernel.

### Ownership Metadata Ahead Of Reality

Some methods are marked as extension-owned even though their implementation still lives in protected runtime. This is acceptable as a migration marker, but it should not remain ambiguous. Each method should eventually be one of:

- runtime primitive;
- backend capability;
- extension handler;
- shell-specific method.

### Dirty Runtime Artifacts

Validation writes meaningful events and screenshots. That is good for Plastic, but noisy for git.

We need a clearer policy for:

- tracked event fixtures;
- untracked local runtime state;
- generated screenshots;
- validation events that should not be committed.

### Naming Residue

The workspace has mostly moved from Clay to Plastic, but path and historical naming residue remains. Public APIs, docs, and extension names should converge on Plastic.

## What Would Make Plastic 10x More Tractable

### 1. Agent Workbench RPC

Add one high-signal method:

```text
agent/workbench
```

It should return:

- current app/build/runtime status;
- focused window and panel;
- visible refs;
- panel/extension/source ownership;
- recent event timeline;
- dirty git files;
- available methods grouped by owner;
- recommended next actions;
- validation checklist for the current context.

This reduces orientation cost. Agents should not have to stitch together `plastic/snapshot`, `plastic/methods`, `events/timeline`, `deixis/listVisibleRefs`, `git status`, and ad hoc screenshots just to know where they are.

### 2. Typed RPC And Event Schemas

Use Effect Schema for:

- RPC input;
- RPC output;
- durable event payloads;
- extension manifests;
- renderer contracts.

Success:

- `plastic/methods` can expose machine-readable schemas.
- Invalid calls fail with useful typed errors.
- Agents can discover exactly how to call methods.

### 3. Runtime Kernel

Extract a shared kernel with explicit services:

- `EventStoreService`
- `MethodRegistryService`
- `ExtensionRegistryService`
- `ProjectionService`
- `RuntimeBusService`
- `BuildControlService`
- `AgentOrientationService`

Success:

- Electron shell and headless shell are thin.
- Runtime behavior is testable without Electron.
- Extension behavior is loaded through the same path in both modes.

### 4. Source-Aware Deixis

Every renderer contribution should be able to report source ownership for visible refs.

Success:

- `data-plastic-ref` can traverse to manifest and renderer source.
- `deixis/resolveRef` can recommend exact lifecycle actions.
- Agents can edit the thing they are looking at.

### 5. Deterministic Validation Harness

Add a validation command that can run without human judgment:

```bash
pnpm validate
```

It should run:

- typecheck;
- lint/guardrails;
- headless self-test;
- extension scan/verify;
- selected browser/UI smoke tests when Electron is available;
- file-size/function-size checks.

## Proposed Pre-Commit Guardrails

These are intentionally conservative. The point is not style policing; the point is preserving agent tractability.

### File Size Limits

Hard warnings:

- TypeScript source file over 500 lines.
- Renderer/controller file over 400 lines.
- Runtime orchestration file over 500 lines.
- CSS file over 500 lines.

Hard failure:

- Any non-generated TypeScript file over 800 lines unless listed in an explicit allowlist with a reason.

Rationale: large files become hard for agents to inspect, patch, and reason over without collateral edits.

### Function Size Limits

Hard warnings:

- Function over 80 lines.
- Method registration handler over 60 lines.
- Renderer `render` function over 80 lines.

Hard failure:

- Function over 140 lines unless allowlisted with a reason.

Rationale: long functions hide multiple responsibilities and make validation boundaries unclear.

### Method Registration Rules

Warn or fail when:

- a method id is registered without title;
- a method id is registered without owner;
- a mutating method lacks durable event append or an explicit `transient: true` metadata marker;
- an extension-owned method is implemented in protected runtime without a migration note;
- a method lacks input/output schema once schemas exist.

Rationale: RPC is the app's nervous system. It must teach agents how to use it.

### Event Rules

Warn or fail when:

- event type is not namespaced, such as `panel.created` or `chat.user_message.submitted`;
- mutating runtime code changes state without appending an event;
- event payload uses unstable or ambiguous ids;
- event schema is missing once schemas exist.

Rationale: replay and rewind depend on durable, legible events.

### Extension Rules

Warn or fail when:

- extension manifest id does not match source namespace conventions;
- renderer id does not start with extension id;
- panel contribution references a missing renderer id;
- extension method declaration has no handler or explicit `metadataOnly: true`;
- bundled extension contains product-specific code outside its extension folder without a note.

Rationale: everything above protected runtime should be forkable and discoverable.

### Import Boundary Rules

Warn or fail when:

- renderer modules import main-process modules;
- extension renderer modules import protected internals beyond the renderer API;
- protected runtime imports workspace extension code directly outside the loader;
- headless imports Electron.

Rationale: boundaries keep Electron, headless, runtime, and extensions independently understandable.

### Generated And Runtime Artifact Rules

Warn or fail when:

- screenshots under `.plastic` are staged accidentally;
- local runtime logs are staged accidentally;
- event log changes are staged without an explicit validation note or fixture policy;
- generated Vite/Electron outputs are staged.

Rationale: Plastic writes useful local state, but git should not become noisy or misleading.

### Naming Rules

Warn or fail when new public API names use `clay`.

Allow:

- historical docs when explicitly discussing migration;
- existing filesystem paths until a planned rename is executed.

Rationale: public vocabulary should converge on Plastic.

### Validation Rules

Before commit, require:

- TypeScript typecheck.
- Guardrail script.
- If RPC/runtime changed: `plastic/selfTest` through Electron or headless.
- If renderer changed: browser or screenshot validation.
- If extension loader changed: `extensions/scan` and at least one extension get/register/verify path.

Rationale: Plastic is built by agents through runtime evidence, not static confidence alone.

## Implementation Plan For Guardrails

### Phase 1: Script-Only Guardrails

Add:

```bash
pnpm guardrails
```

Checks:

- file line counts;
- function line counts via TypeScript AST;
- banned public `clay` names;
- staged generated/runtime artifacts;
- method registration metadata basics;
- extension manifest consistency.

This can run in pre-commit and in `pnpm validate`.

### Phase 2: Schema-Aware Guardrails

After Effect Schema lands:

- require schemas for RPC methods;
- require schemas for durable event payloads;
- expose schemas through `plastic/methods`;
- validate extension manifests with schema.

### Phase 3: Runtime-Aware Guardrails

Add checks that call Plastic:

- `plastic/selfTest`;
- `extensions/scan`;
- `extensions/verify`;
- `agent/workbench`;
- smoke panel creation/removal in headless mode.

These should be optional in pre-commit but required in CI or `pnpm validate`.

## Recommended Next Slice

Build Phase 1 guardrails and use them immediately against the current repo.

Concrete work:

1. Add `scripts/guardrails.mjs`.
2. Add `pnpm guardrails`.
3. Report current violations without failing at first.
4. Add an allowlist file for known temporary violations, especially `apps/desktop/src/main/main.ts`.
5. Convert high-signal checks to failures once the baseline is clean.

This gives agents a local compass before the next big refactor into a shared runtime kernel.
