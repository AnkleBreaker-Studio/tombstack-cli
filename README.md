# Tombstack CLI tools (Node 18+, no deps)

- **`uploader/upload.mjs`** — drain a directory of crash JSON sidecars to the ingestion endpoint (offline-first; for native/custom engines). Auth: a **per-game** ingest token (`tmb_…`).
- **`symbols/symbols.mjs`** — upload a build's symbol file (PDB/dSYM/.sym) to the symbol store from CI. Auth: a **studio key** (`tmb_st_…`, write scope) + `TOMBSTACK_GAME_ID` — per-game tokens are ingest-only and can't upload symbols.
- **`doctor/doctor.mjs`** — post a synthetic crash + heartbeat and read it back to confirm an integration end to end.

All read `TOMBSTACK_BASE_URL` + `TOMBSTACK_TOKEN` from the env; `symbols` also reads `TOMBSTACK_GAME_ID`.

Run directly with `node` (they have zero dependencies), e.g.:

```bash
TOMBSTACK_BASE_URL=https://<host> TOMBSTACK_TOKEN=tmb_st_… TOMBSTACK_GAME_ID=<gameId> \
  node symbols/symbols.mjs GameAssembly.sym 1.5.0 GameAssembly.dll <debugId> windows
```

`package.json` also declares `bin` names (`tombstack-symbols` / `tombstack-upload` / `tombstack-doctor`) for `npx`/global-install use once this package is published to a registry or a public git mirror.
