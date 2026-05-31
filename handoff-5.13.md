# Plastic Handoff - 2026-05-13

## Current State

Plastic is in a good early shape for the self-building direction:

- Electron/Vite/TypeScript app starts with `pnpm dev`.
- Durable JSONL event store is working at `.plastic/events/events.jsonl`.
- Panels can be created, removed, and projected from state.
- Chat panels are backed by Codex app-server threads.
- Chat UI has been tightened: fixed bottom composer, more canonical message styling, subtler user bubbles, stable ordering, closable panels.
- Runtime RPC exists at `POST /rpc`; useful methods include `plastic/state`, `plastic/methods`, `panels/list`, `panels/create`, `panels/remove`, `panels/sendMessage`, `chats/createCodexChat`, `chats/sendToCodex`, `chats/getBinding`, and Codex passthroughs.
- A formal bus spec was started in `docs/PLASTIC_RPC_BUS_SPEC.md`.

The dev server was stopped before ending today.

## Uncommitted Work

There are currently uncommitted changes in:

- `apps/desktop/src/main/main.ts`
- `apps/desktop/src/main/codex-adapter.ts`
- `docs/PLASTIC_RPC_BUS_SPEC.md`

These changes are intentionally not committed yet because the final proof path is not complete.

What the changes do:

- Bind the runtime RPC server to `0.0.0.0` instead of only `127.0.0.1`.
- Publish bus URLs in `plastic/state` and `build/status`.
- Add a HATEOAS-style `rpc-bus` resource.
- Add `rpc/call`, which routes back into the shared Plastic method registry.
- Pass `PLASTIC_RPC_URL`, `PLASTIC_RPC_URLS`, and `PLASTIC_RUNTIME_PORT` into Codex app-server.
- Try to expose a native Codex dynamic tool called `plastic_rpc`.
- Add server-request handling for `item/tool/call` so a Codex dynamic tool can call the Plastic method registry.

## What Was Proven

External control from this session works:

- `curl`/Node fetch to `http://127.0.0.1:7331/rpc` works when the app is running.
- `plastic/state` reports the bus URLs.
- From outside the app, we can create Codex chat panels and inject user turns with `chats/sendToCodex`.

The app also successfully listened on all interfaces:

- `runtimeHost: 0.0.0.0`
- `runtimePort: 7331`
- Published URLs included loopback, LAN IP, and `host.docker.internal`.

## What Failed

The target proof was:

1. From this session, create Chat A.
2. Ask Chat A to create Chat B.
3. Ask Chat A to message Chat B.
4. Verify Chat B receives and reacts.

This did not complete.

Reason:

- Chat agents cannot reliably use shell/curl to reach the local RPC server. Their command sandbox returned `Operation not permitted` for local TCP.
- I tried Codex app-server dynamic tools as the right bridge.
- The upstream Codex source documents `dynamicTools` on `thread/start` plus `item/tool/call`.
- However, the installed `codex app-server generate-ts` schema in this environment shows `ThreadStartParams` does not include `dynamicTools`.
- Because of that, our `dynamicTools` field is silently ignored by the installed app-server, so the model never sees `plastic_rpc` as a callable tool.

This is an important finding: the design is right, but this installed Codex app-server version does not yet expose the needed dynamic tool path.

## Best Next Move

Build a Plastic MCP server and register it with Codex for Plastic chat threads.

Why:

- MCP tools are supported by the installed app-server today.
- Codex chat agents already know how to call MCP tools.
- This gives agents an in-process/native-feeling Plastic bus tool without relying on shell networking.
- The MCP tool should still be only a transport adapter over the same Plastic RPC method registry.

Proposed next implementation:

1. Add `apps/desktop/src/main/plastic-mcp-server.ts` or `scripts/plastic-mcp-server.mjs`.
2. Implement one MCP tool:
   - name: `plastic_rpc`
   - input: `{ method: string, input?: object }`
   - behavior: POST to `PLASTIC_RPC_URL`, returning JSON text.
3. On app startup, make sure Codex config includes an MCP server entry for Plastic, probably using `codex/config/value/write` or a small controlled edit to `~/.codex/config.toml`.
4. Call `config/mcpServer/reload` before starting a new chat thread.
5. Start a fresh chat and verify the MCP tool appears.
6. Re-run the proof:
   - external controller creates Chat A;
   - Chat A calls `plastic_rpc` to create Chat B;
   - Chat A calls `plastic_rpc` / `chats/sendToCodex` to message Chat B;
   - Chat B replies.

## Follow-Up Cleanup

- Decide whether to keep or remove the dynamic tool attempt after MCP works.
- If keeping it, gate it behind app-server schema detection or version capability detection.
- Do not commit `vendor/codex` if it exists locally; it was only used as a reference clone.
- Run:

```sh
pnpm typecheck
pnpm build
git diff --check
git status --short
```

Then commit the bus spec plus whichever bridge is actually proven end to end.

## Useful Context

Commands that helped:

```sh
codex app-server generate-ts --out /tmp/codex-ts
rg -n "dynamicTools|DynamicTool|ThreadStartParams" /tmp/codex-ts
```

Key finding from generated schema:

```ts
export type ThreadStartParams = {
  model?: string | null,
  cwd?: string | null,
  approvalPolicy?: AskForApproval | null,
  sandbox?: SandboxMode | null,
  config?: { [key in string]?: JsonValue } | null,
  serviceName?: string | null,
  baseInstructions?: string | null,
  developerInstructions?: string | null,
  personality?: Personality | null,
  ephemeral?: boolean | null,
  sessionStartSource?: ThreadStartSource | null,
  threadSource?: ThreadSource | null
};
```

No `dynamicTools` field is present in the installed app-server schema.

