# Extension Architecture Status

Last updated: 2026-06-01

This document is the current working reference for the "everything is an extension" migration.

The goal is not to make Plastic a first-party app with a plugin API. The goal is a protected runtime plus a fully exposed extension substrate. Bundled chat, document, tasks, and dev surfaces should use the same primitives as user-created extensions, except for explicit recovery/runtime services.

## Current Focus

The active architecture work is moving bundled surfaces out of protected runtime code and into extension-owned manifests and modules.

The protected runtime should become responsible for:

- booting the app;
- preserving and replaying the event stream;
- projecting durable state;
- exposing the RPC bus;
- loading, validating, and recovering extensions;
- providing build/development control;
- providing baseline generic rendering and recovery UI.

Everything above that should be extension-owned.

## What Works Today

Bundled extension manifests are disk-backed:

- `apps/desktop/extensions/bundled/plastic.chat/plastic.extension.json`
- `apps/desktop/extensions/bundled/plastic.document/plastic.extension.json`
- `apps/desktop/extensions/bundled/plastic.tasks/plastic.extension.json`
- `apps/desktop/extensions/bundled/plastic.codex/plastic.extension.json`
- `apps/desktop/extensions/bundled/plastic.agent-dev/plastic.extension.json`

Main scans these manifests at startup with `scanBundledExtensions` and records durable `extension.discovered` events. `extensions/get` exposes the manifest path and source path.

Chat is the first bundled surface with extension-owned renderer code:

- manifest: `apps/desktop/extensions/bundled/plastic.chat/plastic.extension.json`
- renderer module: `apps/desktop/extensions/bundled/plastic.chat/renderer.ts`
- renderer API contract: `apps/desktop/src/renderer/panel-renderer-api.ts`
- renderer registry: `apps/desktop/src/renderer/extension-renderer-registry.ts`

Renderer selection is now manifest-driven for bundled renderer modules:

- extension manifest declares `renderers[].module`;
- core projection preserves `module`;
- renderer shell passes extension renderer contributions into the registry;
- the registry resolves the bundled module path and returns a `PanelRenderer`.

Chat panels still render through `plastic.chat.chat-panel`, but the renderer HTML is no longer defined inside `apps/desktop/src/renderer/main.ts`.

## What Is Still Not Complete

Renderer loading is not fully dynamic yet.

The registry still statically imports known bundled modules so Vite can bundle them. Selection is manifest-driven, but availability is not. Adding a new renderer module still requires changing registry source unless it is covered by a future dynamic discovery mechanism.

Workspace extension renderer code is not loaded yet.

`.plastic/extensions` can be scanned and represented as extension manifests, but a user extension cannot yet contribute a real renderer module that is imported, mounted, and hot-reloaded through the same path as bundled chat.

Extension method declarations are metadata only unless runtime code separately registers handlers.

Extensions can declare methods in manifests, and some chat methods are owned by `plastic.chat`, but extension-provided handler modules are not loaded from extension code yet.

Chat is not fully extension-owned.

The chat renderer moved into the chat extension, but the chat read model and behavior still live mostly in protected/runtime code:

- `chats/messages`
- `chats/addButton`
- `chats/injectUserMessage`
- `chats/createCodexChat`
- `chats/sendToCodex`
- `chats/close`
- Codex thread binding and turn lifecycle

Some of these should remain runtime/backend capabilities, but the chat extension should own the chat surface contract and call runtime capabilities through RPC.

Document, tasks, Codex, and Agent Dev renderers are still mostly generic or protected-renderer code.

They have disk-backed manifests, but they do not yet have extension-owned renderer modules equivalent to chat.

There is no extension lifecycle yet:

- enable;
- disable;
- reload;
- unload;
- verify;
- fork bundled extension into `.plastic/extensions`;
- recover from broken extension.

Deixis is still shallow.

Visible elements expose useful `data-plastic-ref` values, but refs do not consistently resolve to manifest path, renderer module, source span, event lineage, and actionable edit/reload methods.

## Invariants

These invariants should guide the next implementation slices.

1. Protected runtime code must not contain product-specific renderer HTML for bundled surfaces.

2. Bundled extensions and workspace extensions should converge on the same manifest and module contracts.

3. Extension contributions must be discoverable through RPC before an agent uses them.

4. Any meaningful extension change must be recorded in the durable event stream.

5. Renderer modules must receive projected state, not read raw app internals directly.

6. Renderer modules should emit stable refs/source metadata so agents can point at UI and traverse to extension code.

7. Broken extension code must not prevent the protected runtime from booting, rendering recovery UI, listing extensions, or accepting RPC.

8. Every architecture step must be empirically validated end to end.

## Validation Loop

Each slice should run at least:

```bash
pnpm typecheck
```

Then validate through Plastic itself:

- `plastic/selfTest` passes.
- `extensions/get` shows the expected extension metadata.
- `panels/list` shows expected panel `extensionId` and `rendererId`.
- Browser DOM shows the expected visible panels and controls.

For renderer work, browser validation should confirm:

- expected panel headings;
- expected renderer shell count;
- expected inputs/buttons;
- no blank panel body;
- no console-breaking runtime error where practical.

For event/store work, validate:

- latest durable event contains the new metadata;
- replayed projections expose the new state through RPC.

## Next Milestones

### 1. Dynamic Renderer Discovery

Use Vite-supported discovery, likely `import.meta.glob`, to make renderer module availability data-driven.

Success criteria:

- bundled renderer modules are discovered without adding each one manually to a map;
- `plastic.chat` still renders through its manifest `module`;
- adding another bundled renderer module only requires manifest/module file changes;
- `pnpm typecheck`, `plastic/selfTest`, and browser DOM checks pass.

### 2. Workspace Renderer Modules

Support renderer modules under `.plastic/extensions`.

Success criteria:

- create a minimal workspace extension with `plastic.extension.json` and `renderer.ts`;
- scan extension through RPC;
- register or create a panel from it;
- panel renders custom HTML from the workspace renderer;
- editing the renderer can be reloaded or hot-updated;
- failure falls back to generic/recovery rendering.

### 3. Bundled Extension Forking

Add `extensions/forkBundled`.

Success criteria:

- fork `plastic.chat` into `.plastic/extensions`;
- preserve lineage metadata;
- scan and expose the forked extension;
- create a panel using the fork;
- modify fork renderer and verify the UI changes without editing protected code.

### 4. Extension Method Handler Modules

Define and load extension-provided RPC handlers.

Success criteria:

- extension manifest declares method module or handler exports;
- runtime loads/registers handlers with owner `{ kind: "extension", id }`;
- method calls write durable events as appropriate;
- broken handlers do not break the whole runtime.

### 5. Move Chat Surface Behavior Behind Extension Boundary

Keep Codex as a runtime/backend capability, but move chat surface ownership into `plastic.chat`.

Success criteria:

- chat read model contract is explicit;
- chat renderer consumes only that contract;
- chat methods are extension-owned where appropriate;
- Codex adapter exposes backend methods that chat calls through RPC;
- alternate chat renderers can render the same underlying chat state.

### 6. Deixis To Source

Make visible UI resolve to extension source.

Success criteria:

- `deixis/resolveRef` for a chat compose or button returns panel id, extension id, manifest path, renderer module, command/method, recent event lineage, and next actions;
- the same works for workspace extension panels;
- agents can use the result to edit/reload/verify the owning extension.

## Practical Next Slice

The next thin slice should be dynamic renderer discovery for bundled modules using Vite-safe module discovery.

Proposed implementation:

1. Replace the manual `bundledRendererFactoriesByModule` import map with a registry built from `import.meta.glob`.
2. Preserve the current `createExtensionRendererFromContribution` API.
3. Keep chat-specific host context adaptation for now.
4. Validate that `plastic.chat` still resolves from `extension.path + renderer.module`.

This moves us from "manifest-selected but manually available" to "manifest-selected and discovered by module graph."
