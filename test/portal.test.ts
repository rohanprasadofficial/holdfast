import { test } from "node:test";
import assert from "node:assert/strict";
import { STALE_MS, repoState, type Repo } from "../src/backup.ts";
import { parseRetention } from "../src/settings.ts";

test("parseRetention", () => {
  assert.equal(parseRetention("30"), 30);
  assert.equal(parseRetention("0"), 0);
  assert.equal(parseRetention("3650"), 3650);
  for (const v of ["", " ", "-1", "1.5", "3651", "abc", null]) assert.equal(parseRetention(v), null, String(v));
});

test("repoState: running, then interrupted when a run never reports back", () => {
  const now = 1_000_000_000;
  const r = { status: "ok", paused: 0, started_at: null } as unknown as Repo;
  assert.equal(repoState(r, now), "ok");
  assert.equal(repoState({ ...r, paused: 1 }, now), "paused");
  assert.equal(repoState({ ...r, started_at: now - 60_000 }, now), "running");
  assert.equal(repoState({ ...r, started_at: now - STALE_MS - 1 }, now), "interrupted");
  assert.equal(repoState({ ...r, status: "error" }, now), "error");
});
