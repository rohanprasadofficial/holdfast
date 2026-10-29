// Free mode: size is checked before downloading, and a small repo is saved with one put.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runBackup, type Repo } from "../src/backup.ts";

const pkt = (s: string) => (s.length + 4).toString(16).padStart(4, "0") + s;
const SHA = "a".repeat(40);
const refsReply = pkt("# service=git-upload-pack\n") + "0000" + pkt(`${SHA} HEAD\0ofs-delta\n`) + pkt(`${SHA} refs/heads/main\n`) + "0000";

function fakeEnv() {
  const puts: { key: string; body: Blob }[] = [];
  const stmt = { bind: () => stmt, run: async () => ({}), all: async () => ({ results: [] }) };
  const env = {
    PLAN: "free",
    DB: { prepare: () => stmt },
    BUCKET: {
      put: async (key: string, body: Blob) => { puts.push({ key, body }); },
      list: async () => ({ objects: [], truncated: false }),
      delete: async () => {},
    },
  } as unknown as Env;
  return { env, puts };
}

function fakeGitHub(sizeKb: number) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/info/refs")) return new Response(refsReply);
    if (url.startsWith("https://api.github.com/repos/")) return Response.json({ size: sizeKb });
    if (url.endsWith("/git-upload-pack")) return new Response("0008NAK\nPACKfake");
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return calls;
}

const repo = { id: 1, url: "https://github.com/acme/app", name: "github.com/acme/app", interval_min: 1440, refs_hash: null } as Repo;
const realFetch = globalThis.fetch;

test("free mode refuses a repo over the size cap before downloading it", async () => {
  const calls = fakeGitHub(100 * 1024);
  const { env, puts } = fakeEnv();
  try {
    const r = await runBackup(env, repo);
    assert.equal(r.ok, false);
    assert.match(r.message, /Too large for the Workers Free plan: about 100 MB/);
    assert.ok(!calls.some((u) => u.endsWith("/git-upload-pack")));
    assert.equal(puts.length, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("free mode saves a small repo as one bundle", async () => {
  fakeGitHub(10);
  const { env, puts } = fakeEnv();
  try {
    const r = await runBackup(env, repo);
    assert.deepEqual(r, { ok: true, saved: true, message: "Saved a new copy" });
    assert.equal(puts.length, 1);
    assert.match(puts[0].key, /^repos\/github\.com\/acme\/app\/.+\.bundle$/);
    assert.equal(await puts[0].body.text(), `# v2 git bundle\n${SHA} HEAD\n${SHA} refs/heads/main\n\nPACKfake`);
  } finally {
    globalThis.fetch = realFetch;
  }
});
