# Codex App Server Integration Notes

Reference source:

- Local sparse clone: `vendor/codex/codex-rs/app-server`
- Upstream commit inspected: `e33cf9ae2`

## What Codex Provides

`codex app-server` is the server interface Codex uses for rich app integrations. It is a strong fit for Plastic because it already exposes Codex as a long-lived local service with structured messages, streaming notifications, file/process capabilities, and thread lifecycle APIs.

Supported transports:

- `stdio://` JSONL, default;
- `ws://IP:PORT`, experimental;
- `unix://` local socket;
- `off`.

For Plastic v0, the safest initial path is to spawn/connect over `stdio://`, then consider `unix://` once the adapter is stable.

## Protocol Shape

Codex app-server uses JSON-RPC 2.0-style messages without the explicit `"jsonrpc":"2.0"` field on the wire.

Connection lifecycle:

1. Open transport.
2. Send `initialize` with Plastic client metadata.
3. Send `initialized` notification.
4. Start or resume a thread.
5. Send user input with `turn/start`.
6. Consume streaming notifications for turn/item progress.

Plastic should record all meaningful Codex notifications into Plastic's own event stream.

## Core Codex Primitives

Codex app-server models conversation as:

- **Thread**: conversation between a user and Codex.
- **Turn**: one user input and resulting agent work.
- **Item**: user inputs, agent messages, reasoning, shell commands, file edits, and other turn contents.

Plastic mapping:

- Codex thread -> Plastic agent session / chat binding.
- Codex turn -> Plastic agent run.
- Codex item -> Plastic durable events, chat messages, tool/action records, and deixis references where possible.

## First Adapter Methods

Plastic should expose a Codex adapter through normal HATEOAS/RPC discovery.

Initial methods:

- `codex/connect`
- `codex/initialize`
- `codex/threadStart`
- `codex/threadResume`
- `codex/threadList`
- `codex/turnStart`
- `codex/turnInterrupt`
- `codex/subscribe`

The adapter should also contribute actions to relevant chat panel resources, such as:

- "Send message to Codex"
- "Resume Codex thread"
- "Fork Codex thread"
- "Interrupt active turn"

## Event Mapping

Codex notifications should be written into Plastic's single event stream.

Initial Plastic event types:

- `codex.connection.started`
- `codex.connection.initialized`
- `codex.thread.started`
- `codex.thread.resumed`
- `codex.turn.started`
- `codex.turn.completed`
- `codex.turn.interrupted`
- `codex.item.started`
- `codex.item.completed`
- `codex.agent_message.delta`
- `codex.agent_message.completed`
- `codex.command.started`
- `codex.command.output_delta`
- `codex.command.completed`
- `codex.file.changed`

Chat-facing agent messages should also append normal Plastic chat events, so panels and agents can read a single stream without knowing Codex internals.

## Generated Schema

The app-server can generate TypeScript and JSON Schema for its protocol:

```bash
codex app-server generate-ts --out DIR
codex app-server generate-json-schema --out DIR
```

Once Plastic can execute the local Codex binary, we should generate schemas into a non-vendored location and build the adapter against those generated types.

## Important Methods From README

Most relevant early APIs:

- `initialize`
- `thread/start`
- `thread/resume`
- `thread/fork`
- `thread/list`
- `thread/read`
- `thread/archive`
- `turn/start`
- `turn/interrupt`
- `turn/steer`
- `command/exec`
- `fs/readFile`
- `fs/writeFile`
- `fs/watch`
- `model/list`
- `config/read`

Experimental but interesting later:

- `thread/realtime/start`
- `process/spawn`
- `externalAgentConfig/detect`
- `externalAgentConfig/import`
- plugin/skill/app APIs

## Design Choice For Plastic

Plastic should not treat Codex as special UI. Codex is one embodied agent runtime behind the same Plastic adapter pattern that future agents can use.

The Codex adapter should:

- register methods in Plastic's method registry;
- expose HATEOAS actions through `plastic/state`;
- write all messages and notifications to Plastic's event store;
- bind Codex threads to Plastic chat panels;
- expose active Codex turns/items through deixis where possible;
- eventually connect Codex file edits/commands to UI references and source traversal.

