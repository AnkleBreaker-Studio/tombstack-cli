#!/usr/bin/env node
/**
 * tombstack-symbols — register + upload a debug-symbol file (PDB / dSYM / .sym)
 * for a build, from CI or a dev machine. Zero dependencies, Node 18+.
 *
 *   TOMBSTACK_BASE_URL=https://<host> TOMBSTACK_TOKEN=tmb_st_… TOMBSTACK_GAME_ID=<gameId> \
 *     node tools/symbols/symbols.mjs <file> <buildVersion> <moduleName> <debugId> [os]
 *
 *   os: windows | macos | linux | android | ios | other (default: windows)
 *   For a whole Unity/Android symbols.zip, prefer `tombstack-symbols-zip` — it extracts every module
 *   + debugId server-side (no per-file debugId needed).
 *
 * TOKEN: use a STUDIO key (tmb_st_…, minted on Team ▸ Studio read keys) together with
 * TOMBSTACK_GAME_ID — studio keys carry the `write` scope symbol upload needs and work across every
 * game in the studio, which is exactly the CI shape. A per-game tmb_… token is ingest-only by
 * default and will 403 here unless it was explicitly minted with the `write` scope; if you do use a
 * per-game token, TOMBSTACK_GAME_ID is optional (the token already resolves its own game).
 *
 * Flow: POST /api/v1/symbols[?gameId=…] (registers the file, idempotent) → presigned S3 POST → upload
 * (the presigned POST enforces a server-side size cap via its content-length-range condition).
 */
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

const BASE = (process.env.TOMBSTACK_BASE_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.TOMBSTACK_TOKEN ?? "";
const GAME_ID = process.env.TOMBSTACK_GAME_ID ?? "";
const [file, buildVersion, moduleName, debugId, os = "windows"] = process.argv.slice(2);

if (!BASE || !TOKEN) {
  console.error("set TOMBSTACK_BASE_URL and TOMBSTACK_TOKEN");
  process.exit(2);
}
// A studio key (tmb_st_…) must name the target game; a per-game token resolves its own game.
if (TOKEN.startsWith("tmb_st_") && !GAME_ID) {
  console.error("studio keys (tmb_st_…) require TOMBSTACK_GAME_ID=<gameId>");
  process.exit(2);
}
if (!file || !buildVersion || !moduleName || !debugId) {
  console.error(
    "usage: tombstack-symbols <file> <buildVersion> <moduleName> <debugId> [windows|macos|linux|android|ios|other]",
  );
  process.exit(2);
}

const info = await stat(file).catch(() => null);
if (!info || !info.isFile()) {
  console.error(`not a file: ${file}`);
  process.exit(2);
}

const registerUrl = GAME_ID
  ? `${BASE}/api/v1/symbols?gameId=${encodeURIComponent(GAME_ID)}`
  : `${BASE}/api/v1/symbols`;
const register = await fetch(registerUrl, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ buildVersion, moduleName, debugId, os, size: info.size }),
});
if (register.status !== 201) {
  console.error(`register failed: HTTP ${register.status} ${await register.text()}`);
  process.exit(1);
}
const { data } = await register.json();
const upload = data?.upload;
if (!upload?.url || !upload?.fields) {
  console.error("register response missing upload url/fields");
  process.exit(1);
}

const bytes = await readFile(file);
// Presigned-POST upload: policy fields first (in order), then the file LAST (S3 requires it). S3
// rejects an over-cap body via the content-length-range condition baked into the signed policy.
const form = new FormData();
for (const [k, v] of Object.entries(upload.fields)) form.append(k, v);
form.append("file", new Blob([bytes], { type: "application/octet-stream" }), basename(file));
const res = await fetch(upload.url, { method: "POST", body: form });
if (!(res.status >= 200 && res.status < 300)) {
  console.error(`upload failed: HTTP ${res.status}`);
  process.exit(1);
}

console.log(
  `uploaded ${basename(file)} (${(info.size / 1024 / 1024).toFixed(1)} MB) — build ${buildVersion}, module ${moduleName}`,
);
