# Plastic

Plastic is an experimental agent-native Electron workspace. The app is built from a durable event stream, a permissive local RPC bus, and extensions that can own panels, methods, and runtime behavior.

## Status

This repository is early research software. It is useful for local development and architecture exploration, but it is not hardened for untrusted extensions, remote access, or production use.

## Development

```bash
corepack enable
pnpm install
pnpm dev
```

Useful local endpoints:

- UI: `http://127.0.0.1:5173/`
- Runtime RPC: `http://127.0.0.1:7331/rpc`
- Build socket: `http://127.0.0.1:7332/`

Headless mode can run beside Electron:

```bash
PLASTIC_RUNTIME_PORT=7341 \
PLASTIC_RPC_URL=http://127.0.0.1:7341/rpc \
PLASTIC_STATIC_PORT=5174 \
pnpm --filter @plastic/desktop dev:headless
```

## Data

Runtime event logs and user/workspace data are not source files. By default, Plastic writes durable runtime data under:

```text
~/.plastic/workspaces/<workspace-slug>/
```

Workspace extensions used during local development live under `.plastic/extensions/` and are ignored by Git.

## Security

Plastic v0 is fully permissive. Treat the local RPC bus and extensions as trusted local development surfaces. Do not expose Plastic runtime ports to untrusted networks.
