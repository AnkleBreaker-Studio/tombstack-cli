#!/usr/bin/env node
/**
 * tombstack-doctor — verify a Tombstack integration end to end. Posts a synthetic crash +
 * heartbeat with your token, then reads the summary back to confirm the whole loop works.
 *
 *   TOMBSTACK_BASE_URL=https://<host> TOMBSTACK_TOKEN=tmb_… node doctor.mjs
 *
 * Exits 0 on PASS, 1 on FAIL. The synthetic crash is harmless (90-day TTL).
 */
const BASE = (process.env.TOMBSTACK_BASE_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.TOMBSTACK_TOKEN ?? "";

if (!BASE || !TOKEN) {
  console.error("set TOMBSTACK_BASE_URL and TOMBSTACK_TOKEN");
  process.exit(2);
}

const now = new Date().toISOString();
const sig = `doctor-${Date.now()}`;
const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
let allOk = true;

async function step(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}: ${e instanceof Error ? e.message : e}`);
    allOk = false;
  }
}

await step("ingest crash → 201", async () => {
  const res = await fetch(`${BASE}/api/v1/ingest/crashes`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      occurredAtIso: now,
      buildVersion: "doctor",
      os: "other",
      arch: "other",
      signature: sig,
      stackHint: "tombstack-doctor smoke test",
    }),
  });
  if (res.status !== 201) throw new Error(`HTTP ${res.status}`);
});

await step("ingest heartbeat → 202", async () => {
  const res = await fetch(`${BASE}/api/v1/ingest/heartbeats`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ sessionId: sig, occurredAtIso: now, buildVersion: "doctor", os: "other", arch: "other" }),
  });
  if (res.status !== 202) throw new Error(`HTTP ${res.status}`);
});

await step("read summary reflects the crash", async () => {
  const res = await fetch(`${BASE}/api/v1/read/crashes/summary?days=1`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!(json?.data?.totalCrashes24h >= 1)) throw new Error("crash not reflected in summary");
});

console.log(allOk ? "\nPASS — Tombstack integration works." : "\nFAIL — see errors above.");
process.exit(allOk ? 0 : 1);
