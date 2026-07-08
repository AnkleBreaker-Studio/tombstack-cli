# Tombstack CLI tools (Node 18+, no deps)

- **`uploader/upload.mjs`** — drain a directory of crash JSON sidecars to the ingestion endpoint (offline-first; for native/custom engines). Auth: a **per-game** ingest token (`tmb_…`).
- **`symbols/symbols.mjs`** — upload a single build symbol file (PDB/dSYM/.sym) to the symbol store from CI, with an explicit `debugId`. Auth: a **studio key** (`tmb_st_…`, write scope) + `TOMBSTACK_GAME_ID` — per-game tokens are ingest-only and can't upload symbols.
- **`symbols/symbols-zip.mjs`** — upload a whole symbols **archive** (Unity/Android `symbols.zip`); the server unzips it and extracts every module + debugId itself (no per-file metadata). Same studio-key + `TOMBSTACK_GAME_ID` auth. Use this for Android IL2CPP builds.
- **`doctor/doctor.mjs`** — post a synthetic crash + heartbeat and read it back to confirm an integration end to end.

All read `TOMBSTACK_BASE_URL` + `TOMBSTACK_TOKEN` from the env; `symbols` also reads `TOMBSTACK_GAME_ID`.

Run directly with `node` (they have zero dependencies), e.g.:

```bash
TOMBSTACK_BASE_URL=https://<host> TOMBSTACK_TOKEN=tmb_st_… TOMBSTACK_GAME_ID=<gameId> \
  node symbols/symbols.mjs GameAssembly.sym 1.5.0 GameAssembly.dll <debugId> windows
```

Published to the public **[AnkleBreaker-Studio/tombstack-cli](https://github.com/AnkleBreaker-Studio/tombstack-cli)** mirror (synced from this dir via `scripts/publish-cli-repo.ps1`), so CI can run the `bin` names with zero setup — no checkout, no `npm install`:

```bash
npx --yes --package github:AnkleBreaker-Studio/tombstack-cli tombstack-symbols <file> <build> <module> <debugId> [os]
```

Pin a release with `github:AnkleBreaker-Studio/tombstack-cli#v0.2.1`.
