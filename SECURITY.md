# Security

Plastic is an experimental local agent substrate. Current builds are intended for trusted local development only.

## Current Security Model

- The local RPC bus is permissive in v0.
- Extensions are trusted code and may register methods that can mutate app state.
- Runtime event logs and user/workspace data should live outside the repository under `~/.plastic` by default.
- Do not expose Plastic runtime ports to untrusted networks.

## Reporting

Please open a private security advisory on GitHub or contact the maintainers before disclosing exploitable issues publicly.
