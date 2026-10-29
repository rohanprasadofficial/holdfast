import { bundleHeader, fetchPack, listRefs } from "./git.ts";
import { tokenFor } from "./github.ts";
import { getSettings } from "./settings.ts";

export type Repo = {
  id: number; url: string; name: string; source_id: number | null; interval_min: number; paused: number;
  next_run_at: number; started_at: number | null; refs_hash: string | null; status: "pending" | "ok" | "error"; error: string | null;
  last_checked_at: number | null; last_saved_at: number | null; size: number | null;
};

const PART = 5 * 1024 * 1024; // R2 multipart: every part but the last must be the same size (min 5 MiB)
const RETRY_MIN = 30;
// A run still marked as started after this long was cut off (time or CPU limit) and never reported back.
export const STALE_MS = 20 * 60_000;

/** What the portal shows for a repo. */
export function repoState(r: Repo, now = Date.now()) {
  if (r.started_at) return now - r.started_at < STALE_MS ? "running" : "interrupted";
  return r.paused ? "paused" : r.status;
}

/** R2 folder holding this repo's copies. The trailing slash keeps "a/b" and "a/b-2" apart. */
export const prefix = (repo: Pick<Repo, "name">) => `repos/${repo.name}/`;

/** Git request headers. A GitHub token only ever goes to https://github.com, never to other git hosts. */
export function gitHeaders(url: string, env: Env): Record<string, string> {
  const u = new URL(url);
  const token = u.protocol === "https:" && u.hostname === "github.com" ? tokenFor(env, u.pathname.split("/")[1] ?? "") : undefined;
  return { "User-Agent": "git/holdfast", ...(token ? { Authorization: `Basic ${btoa(`x-access-token:${token}`)}` } : {}) };
}

/** Checks one repo and saves a new copy if any branch or tag moved. Never throws; the outcome lands in D1. */
export async function runBackup(env: Env, repo: Repo): Promise<{ ok: boolean; message: string }> {
  const now = Date.now();
  try {
    const { refs, base } = await listRefs(repo.url, gitHeaders(repo.url, env));
    const hash = await sha256(refs.map((r) => `${r.sha} ${r.name}`).join("\n"));
    let message = refs.length ? "No changes since the last copy" : "Repository is empty, nothing to save";
    if (refs.length && hash !== repo.refs_hash) {
      const pack = await fetchPack(base, refs, gitHeaders(base, env));
      const key = `${prefix(repo)}${new Date(now).toISOString().replace(/[:.]/g, "-")}.bundle`;
      const size = await upload(env.BUCKET, key, (async function* () { yield bundleHeader(refs); yield* pack; })());
      await prune(env, prefix(repo)).catch(() => {}); // best effort: an R2 bucket lock may block deletes, the new copy is saved
      await env.DB.prepare("UPDATE repos SET refs_hash = ?, last_saved_at = ?, size = ? WHERE id = ?").bind(hash, now, size, repo.id).run();
      message = "Saved a new copy";
    }
    await env.DB.prepare("UPDATE repos SET status = 'ok', error = NULL, started_at = NULL, last_checked_at = ? WHERE id = ?").bind(now, repo.id).run();
    return { ok: true, message };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await env.DB.prepare("UPDATE repos SET status = 'error', error = ?, started_at = NULL, last_checked_at = ?, next_run_at = ? WHERE id = ?")
      .bind(message, now, now + Math.min(repo.interval_min, RETRY_MIN) * 60_000, repo.id).run();
    return { ok: false, message };
  }
}

async function upload(bucket: R2Bucket, key: string, chunks: AsyncIterable<Uint8Array>) {
  const up = await bucket.createMultipartUpload(key, { httpMetadata: { contentType: "application/x-git-bundle" } });
  try {
    const parts: R2UploadedPart[] = [];
    let buf = new Uint8Array(PART), n = 0, size = 0;
    for await (let chunk of chunks) {
      size += chunk.length;
      while (chunk.length) {
        const take = Math.min(PART - n, chunk.length);
        buf.set(chunk.subarray(0, take), n);
        n += take;
        chunk = chunk.subarray(take);
        if (n === PART) {
          parts.push(await up.uploadPart(parts.length + 1, buf));
          buf = new Uint8Array(PART);
          n = 0;
        }
      }
    }
    if (n || !parts.length) parts.push(await up.uploadPart(parts.length + 1, buf.subarray(0, n)));
    await up.complete(parts);
    return size;
  } catch (e) {
    await up.abort().catch(() => {});
    throw e;
  }
}

/** Every copy of a repo, oldest first (keys are ISO timestamps). */
export async function listCopies(bucket: R2Bucket, pre: string) {
  const all: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: pre, delimiter: "/", cursor });
    all.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return all.sort((a, b) => a.key.localeCompare(b.key));
}

async function prune(env: Env, pre: string) {
  const days = (await getSettings(env.DB)).retention_days;
  if (!days) return;
  const cutoff = Date.now() - days * 86_400_000;
  const old = (await listCopies(env.BUCKET, pre)).slice(0, -1).filter((o) => o.uploaded.getTime() < cutoff).map((o) => o.key);
  for (let i = 0; i < old.length; i += 1000) await env.BUCKET.delete(old.slice(i, i + 1000));
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
