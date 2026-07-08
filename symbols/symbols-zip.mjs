#!/usr/bin/env node
/**
 * tombstack-symbols-zip — upload a whole symbols ARCHIVE (zip) and let Tombstack extract + index
 * every module server-side (parity with the website's "drop the zip" upload). Zero dependencies,
 * Node 18+. Unlike `tombstack-symbols` (per-file, needs an explicit debugId), this needs NO per-module
 * metadata: the server unzips the archive, identifies each module + ABI, and derives each debugId
 * (GNU build-id for ELF/Android, PDB GUID+age for Windows, LC_UUID for Mach-O).
 *
 *   TOMBSTACK_BASE_URL=https://<host> TOMBSTACK_TOKEN=tmb_st_… TOMBSTACK_GAME_ID=<gameId> \
 *     node tools/symbols/symbols-zip.mjs <archive.zip> [buildVersion]
 *
 * TOKEN must be a STUDIO key (tmb_st_…, Team ▸ Studio read keys) — archive upload needs the `write`
 * scope; per-game ingest tokens 403. buildVersion is an optional label stamped on every extracted
 * module (a Unity symbols.zip carries no app version). Re-uploading the same archive is idempotent.
 *
 * Flow: POST /api/v1/symbols/archive?gameId=… → presigned S3 POST → upload the zip → poll
 * /api/v1/symbols/archive/<uploadId> until processed|failed.
 */
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

const BASE = (process.env.TOMBSTACK_BASE_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.TOMBSTACK_TOKEN ?? "";
const GAME_ID = process.env.TOMBSTACK_GAME_ID ?? "";
const [file, buildVersion] = process.argv.slice(2);

if (!BASE || !TOKEN) {
  console.error("set TOMBSTACK_BASE_URL and TOMBSTACK_TOKEN");
  process.exit(2);
}
if (!GAME_ID) {
  console.error("set TOMBSTACK_GAME_ID (the archive endpoint is studio-key + game scoped)");
  process.exit(2);
}
if (!file) {
  console.error("usage: tombstack-symbols-zip <archive.zip> [buildVersion]");
  process.exit(2);
}

const info = await stat(file).catch(() => null);
if (!info || !info.isFile()) {
  console.error(`not a file: ${file}`);
  process.exit(2);
}

const auth = { Authorization: `Bearer ${TOKEN}` };
const gid = encodeURIComponent(GAME_ID);

// 1. Begin: register a pending upload + get the presigned S3 POST.
const begin = await fetch(`${BASE}/api/v1/symbols/archive?gameId=${gid}`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ fileName: basename(file), buildVersion: buildVersion || undefined }),
});
if (begin.status !== 201) {
  console.error(`begin failed: HTTP ${begin.status} ${await begin.text()}`);
  process.exit(1);
}
const { data } = await begin.json();
const uploadId = data?.uploadId;
const upload = data?.upload;
if (!uploadId || !upload?.url || !upload?.fields) {
  console.error("begin response missing uploadId/upload");
  process.exit(1);
}

// 2. Upload the archive bytes to S3 (presigned POST: policy fields first, file LAST). The signed
//    policy's content-length-range condition enforces the server-side size cap.
const bytes = await readFile(file);
const form = new FormData();
for (const [k, v] of Object.entries(upload.fields)) form.append(k, v);
form.append("file", new Blob([bytes], { type: "application/zip" }), basename(file));
const put = await fetch(upload.url, { method: "POST", body: form });
if (!(put.status >= 200 && put.status < 300)) {
  console.error(`upload failed: HTTP ${put.status} (archive may exceed the server size cap)`);
  process.exit(1);
}
console.log(`uploaded ${basename(file)} (${(info.size / 1024 / 1024).toFixed(1)} MB) — extracting server-side…`);

// 3. Poll processing status. Extraction of a large IL2CPP archive can take a couple of minutes.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEADLINE = Date.now() + 10 * 60 * 1000; // 10 min
for (;;) {
  await sleep(3000);
  const poll = await fetch(`${BASE}/api/v1/symbols/archive/${uploadId}?gameId=${gid}`, { headers: auth });
  if (poll.status !== 200) {
    console.error(`status poll failed: HTTP ${poll.status}`);
    process.exit(1);
  }
  const s = (await poll.json())?.data?.status;
  if (s?.status === "processed") {
    console.log(`processed — ${s.symbolCount} module(s) indexed${s.skippedCount ? `, ${s.skippedCount} skipped` : ""}`);
    process.exit(0);
  }
  if (s?.status === "failed") {
    console.error(`processing failed: ${s.error || "unknown error"}`);
    process.exit(1);
  }
  if (Date.now() > DEADLINE) {
    console.error(`timed out waiting for processing (last status: ${s?.status ?? "unknown"}) — check the dashboard`);
    process.exit(1);
  }
}
