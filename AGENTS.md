# AGENTS.md

## Project

This repo builds Plastic: an agent-native Electron workspace where the app embodies Codex or another agent runtime. The GUI is a projection of durable state, everything meaningful is written to Plastic's event stream, and agents can observe/control/build the app through RPC.

Read these first:

- `PROJECT_PLAN.md`
- `ARCHITECTURE.md`

## Working Rules

- Use TypeScript throughout.
- Use Effect for runtime services, typed errors, resource scopes, and long-lived fibers.
- Prefer simple HTML/CSS/TypeScript view controllers over React.
- Treat the GUI as a projection of state.
- Write meaningful app actions to the event log.
- Keep v0 fully permissive, but preserve method metadata for future permissions.
- Everything above the protected runtime is an extension, including bundled chat/document/tasks panels.
- Extensions live in `.plastic/extensions`.
- Support both single-file `.tsx` extensions and folder extensions with `index.tsx`, `main.ts`, and optional `plastic.extension.json`.
- Maintain HATEOAS-style discovery: agents should learn available methods/actions from `plastic/state` and `plastic/methods`.
- Preserve the two-channel model: runtime control and build control.
- Preserve the deixis model: visible UI should be pointable, commentable, and traceable to app/source/runtime context where possible.

## Editing Expectations

- Keep changes scoped.
- Do not introduce React unless the user explicitly changes the direction.
- Do not add hidden state layers when the event stream/read model can handle it.
- Do not make permission prompts part of v0.
- Do not treat chat/document/tasks as privileged first-party surfaces.
- Use clear names and stable IDs for panels, events, methods, agents, and extensions.

## Useful Commands

```bash
corepack enable
pnpm install
pnpm typecheck
pnpm dev
```

`pnpm dev` should start Vite and Electron for the desktop app once dependencies are installed.

