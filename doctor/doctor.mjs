#!/usr/bin/env node
/**
 * tombstack-doctor — verify a Tombstack integration end to end. Posts a synthetic crash +
 * heartbeat with your token, then (if it can) reads the summary back to confirm the whole loop.
 *
 *   TOMBSTACK_BASE_URL=https://<host> TOMBSTACK_TOKEN=tmb_… node doctor.mjs
 *
 * Optional, to also check the READ path:
 *   TOMBSTACK_READ_TOKEN=tmb_st_…  TOMBSTACK_GAME_ID=<gameId>   (a studio key needs the game id)
 *   TOMBSTACK_READ_TOKEN=tmb_…                                  (a per-game token granted `read`)
 *
 * Exits 0 on PASS, 1 on FAIL. The synthetic crash is harmless (90-day TTL).
 *
 * THE BUG THIS FILE CARRIED. Step 3 reused TOMBSTACK_TOKEN — the per-game ingest token /download tells
 * studios to use — on `/api/v1/read/crashes/summary`. Per-game tokens are ingest-only by default
 * (`api_keys.scopes` defaults to `["ingest"]`), and the read routes answer a scope-less token with 403
 * (src/lib/api-read.ts: `token lacks 'read' scope`), exactly as /docs#api-auth documents. So a studio
 * with a PERFECTLY WORKING integration ran the official verifier and got:
 *
 *     ✓ ingest crash → 201
 *     ✓ ingest heartbeat → 202
 *     ✗ read summary reflects the crash: HTTP 403
 *     FAIL — see errors above.
 *
 * Reproducible for every new customer, because no UI in the product can mint a read-capable per-game
 * token: both mint paths (the settings TokenManager and the onboarding wizard) POST with no body, so
 * `parseScopes(undefined)` returns `["ingest"]`. There was no value of TOMBSTACK_TOKEN that could pass
 * all three steps — a studio key fails steps 1-2 with 401. A verifier that fails on success is worse
 * than no verifier: it teaches a studio to distrust an install that is fine.
 *
 * Two things were wrong and both are fixed here:
 *   1. A 403 on the read step is now reported as EXPECTED for an ingest-only token, not as a failure.
 *      It counts as a failure only when the caller supplied TOMBSTACK_READ_TOKEN, i.e. explicitly asked
 *      for the read path to be checked.
 *   2. The response BODY was discarded (`throw new Error("HTTP " + res.status)`), throwing away the
 *      server's own actionable message. Every step now surfaces it.
 */
const BASE = (process.env.TOMBSTACK_BASE_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.TOMBSTACK_TOKEN ?? "";
/** Optional. A credential that can READ: a studio key `tmb_st_…`, or a per-game token granted `read`. */
const READ_TOKEN = process.env.TOMBSTACK_READ_TOKEN ?? "";
/** Required alongside a studio/MCP key: those are studio-wide, so the read routes demand `?gameId=`. */
const GAME_ID = process.env.TOMBSTACK_GAME_ID ?? "";

if (!BASE || !TOKEN) {
  console.error("set TOMBSTACK_BASE_URL and TOMBSTACK_TOKEN");
  process.exit(2);
}

const now = new Date().toISOString();
const sig = `doctor-${Date.now()}`;
const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
let allOk = true;
let skipCount = 0;

/** Returned by a step that could not run for a legitimate, documented reason — not a fault. */
function skipped(reason) {
  return { skipped: reason };
}

/**
 * Surface the server's own error text. The API envelope is `{ success, error }`, and that string is the
 * difference between "HTTP 403" and "token lacks 'read' scope" — between a mystery and an instruction.
 */
async function describe(res) {
  let detail = "";
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") detail = ` — ${body.error}`;
  } catch {
    // Non-JSON body (a proxy error page, say). The status alone is still worth reporting.
  }
  return `HTTP ${res.status}${detail}`;
}

async function step(name, fn) {
  try {
    const out = await fn();
    if (out && out.skipped) {
      console.log(`• ${name}: ${out.skipped}`);
      skipCount += 1;
      return;
    }
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
  if (res.status !== 201) throw new Error(await describe(res));
});

await step("ingest heartbeat → 202", async () => {
  const res = await fetch(`${BASE}/api/v1/ingest/heartbeats`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ sessionId: sig, occurredAtIso: now, buildVersion: "doctor", os: "other", arch: "other" }),
  });
  if (res.status !== 202) throw new Error(await describe(res));
});

await step("read summary reflects the crash", async () => {
  // Fall back to the ingest token so the step still ATTEMPTS the read: if a studio did grant `read`, the
  // loop gets checked without them having to set a second variable.
  const readToken = READ_TOKEN || TOKEN;
  // A studio (`tmb_st_`) or MCP (`tmb_mcp_`) key is studio-wide; the read routes reject it without a
  // gameId. Say so, instead of reporting the resulting 401 as a broken integration.
  if (/^tmb_(st|mcp)_/.test(readToken) && !GAME_ID) {
    return skipped("read token is a studio/MCP key — also set TOMBSTACK_GAME_ID so it can scope the read");
  }
  const qs = new URLSearchParams({ days: "1" });
  if (GAME_ID) qs.set("gameId", GAME_ID);
  const res = await fetch(`${BASE}/api/v1/read/crashes/summary?${qs}`, {
    headers: { Authorization: `Bearer ${readToken}` },
  });
  // THE FIX. An ingest-only token is the DEFAULT and the documented behaviour, so a 403 here says
  // nothing about the integration — steps 1 and 2 already proved the loop. It is a failure only when the
  // caller supplied a credential specifically to exercise the read path.
  if (res.status === 403 && !READ_TOKEN) {
    return skipped(
      "token is ingest-only (the default) so it cannot read — expected, not a fault. Set TOMBSTACK_READ_TOKEN to a studio key or a read-scoped token to check the read path too.",
    );
  }
  if (!res.ok) throw new Error(await describe(res));
  const json = await res.json();
  if (!(json?.data?.totalCrashes24h >= 1)) throw new Error("crash not reflected in summary");
});

if (allOk) {
  console.log(
    skipCount > 0
      ? "\nPASS — ingestion works. Some checks were skipped (see • above); nothing failed."
      : "\nPASS — Tombstack integration works.",
  );
} else {
  console.log("\nFAIL — see errors above.");
}
process.exit(allOk ? 0 : 1);
