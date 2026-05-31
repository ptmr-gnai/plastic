# Plastic RPC Bus Spec

Plastic has one control bus. Every panel, window, extension, and agent should use it to observe and control the app.

## Goal

The Plastic runtime exposes a single HTTP RPC bus:

```text
POST /rpc
GET /state
GET /methods
GET /events/stream
```

This bus is the common address space for:

- renderer windows;
- bundled panels;
- hot-loaded extensions;
- Codex chat panels;
- external agents launched by Codex, shells, SDKs, or future ACP runtimes.

No agent should need private in-process APIs to operate Plastic. Private bridges may exist as transport adapters, but they must call the same method registry and append the same durable events.

## Addressing

Plastic publishes multiple bus URLs because `localhost` is relative to the caller.

- `http://127.0.0.1:7331/rpc` is valid only for callers in the same network namespace as Electron.
- `http://<host-ip>:7331/rpc` is for sandboxed or external agents that can reach the host but whose own `127.0.0.1` is not Electron.
- Future transports may add Unix sockets or named pipes, but they still target the same RPC method registry.

The canonical discovery method is:

```json
{ "method": "plastic/state", "input": {} }
```

Agents should read `plastic/state`, follow HATEOAS links/actions, and avoid hardcoded method assumptions when possible.

## Runtime Contract

The runtime publishes:

- `PLASTIC_RPC_URL`: preferred reachable URL for agents;
- `PLASTIC_RPC_URLS`: comma-separated fallback URLs;
- `PLASTIC_RUNTIME_PORT`: runtime bus port;
- `PLASTIC_BUILD_PORT`: build/dev bus port.

Some agent command sandboxes cannot open local TCP sockets even when the app can. Codex-backed chat threads therefore also receive a native dynamic tool named `plastic_rpc`. It is a transport adapter, not a second API surface: it calls the same Plastic method registry and writes the same durable event log as `POST /rpc`.

For v0, Plastic is fully permissive. Authentication is intentionally deferred, but the bus contract reserves `Authorization: Bearer <token>` for the first permissioned mode.

## Chat Agent Contract

Every Codex-backed chat thread receives developer instructions that explain:

- it is running inside Plastic;
- its own `chatId`;
- the available bus URLs;
- the native `plastic_rpc` tool;
- the command shape for calling the bus;
- the requirement to call `plastic/state` before guessing panel ids;
- examples for creating a chat and sending a message to a panel.

Example RPC call:

```sh
curl -s -X POST "$PLASTIC_RPC_URL" \
  -H 'content-type: application/json' \
  -d '{"method":"panels/list","input":{}}'
```

Example cross-panel message:

```json
{
  "method": "panels/sendMessage",
  "input": {
    "fromPanelId": "chat-a",
    "toPanelId": "chat-b",
    "messageType": "chat",
    "content": "Hello from chat-a."
  }
}
```

If the target agent should react, the sender must call `chats/sendToCodex` for the target chat. `panels/sendMessage` is a durable mailbox event; it is not an agent turn by itself.

## Acceptance Test

From an external controller:

1. Call `chats/createCodexChat` to create Chat A.
2. Send Chat A a prompt instructing it to call the bus and create Chat B.
3. Verify `panels/list` includes Chat B.
4. Send Chat A a prompt instructing it to call `chats/sendToCodex` or `panels/sendMessage` for Chat B.
5. Verify events show the requested RPC call and the target chat received the message or turn.

The important property is not that the agent uses `curl`; it is that every route resolves to the same Plastic RPC bus and event stream.
