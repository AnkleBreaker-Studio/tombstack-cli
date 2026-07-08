#!/usr/bin/env node
/**
 * tombstack-upload — offline crash uploader for native / custom-engine games.
 *
 * At crash time, write a JSON sidecar (the /api/v1/ingest/crashes body) into a directory.
 * On the next launch, run this to drain the directory:
 *
 *   TOMBSTACK_BASE_URL=https://<host> TOMBSTACK_TOKEN=tmb_… node upload.mjs <crash-dir>
 *
 * - 2xx        → uploaded, file deleted.
 * - 429 / 5xx  → transient, left in place to retry next run.
 * - other 4xx  → unrecoverable (bad payload / auth), file dropped so it can't loop forever.
 *
 * No dependencies; needs Node 18+ (global fetch). This is the same offline-first behavior the
 * Unity SDK has built in — a stopgap for engines without the native core.
 */
import { readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { classifyUploadResult } from "../lib/upload-classify.mjs";

const BASE = (process.env.TOMBSTACK_BASE_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.TOMBSTACK_TOKEN ?? "";
const dir = process.argv[2];

if (!BASE || !TOKEN || !dir) {
  console.error("usage: TOMBSTACK_BASE_URL=https://host TOMBSTACK_TOKEN=tmb_… node upload.mjs <crash-dir>");
  process.exit(2);
}

const endpoint = `${BASE}/api/v1/ingest/crashes`;
let uploaded = 0;
let pending = 0;
let dropped = 0;

let files;
try {
  files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
} catch (e) {
  console.error(`tombstack-upload: cannot read ${dir}: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
}

for (const f of files) {
  const path = join(dir, f);
  let body;
  try {
    body = await readFile(path, "utf8");
    JSON.parse(body); // validate it's JSON before sending
  } catch {
    console.error(`drop ${f}: not valid JSON`);
    await safeUnlink(path);
    dropped++;
    continue;
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body,
    });
    const action = classifyUploadResult(res.status);
    if (action === "delete") {
      await safeUnlink(path);
      uploaded++;
    } else if (action === "keep") {
      pending++; // transient — keep for next run
    } else {
      console.error(`drop ${f}: HTTP ${res.status}`);
      await safeUnlink(path);
      dropped++;
    }
  } catch {
    pending++; // network error — keep for next run
  }
}

console.log(`tombstack-upload: ${uploaded} uploaded, ${pending} pending, ${dropped} dropped (${files.length} total)`);

async function safeUnlink(path) {
  try {
    await unlink(path);
  } catch {
    /* best-effort */
  }
}
