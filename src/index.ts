import { FREE, isFree, listCopies, prefix, runBackup, type Repo } from "./backup.ts";
import { checkToken, listOwnerRepos, parseTarget, tokenFor } from "./github.ts";
import { describeInterval, parseInterval } from "./schedule.ts";
import { getSettings, parseRetention, saveSetting } from "./settings.ts";
import CSS from "./style.css";
import { APP_JS, fileName, homePage, messagePage, repoPage, settingsPage, type Flash, type Source } from "./ui.ts";

const BAD_INTERVAL = "Pick a schedule between 5 minutes and 365 days.";

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

const page = (h: { __html: string }, status = 200) =>
  new Response(h.__html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP, "Referrer-Policy": "same-origin" } });
const redirect = (to: string, flash: Flash) =>
  new Response(null, { status: 303, headers: { Location: `${to}?${new URLSearchParams(flash as Record<string, string>)}` } });

/** Adds repos that aren't tracked yet; 25 rows per statement keeps under D1's 100 bound parameters. */
async function insertRepos(env: Env, urls: string[], sourceId: number | null, interval: number) {
  const stmts = [];
  for (let i = 0; i < urls.length; i += 25) {
    const rows = urls.slice(i, i + 25);
    stmts.push(env.DB.prepare(`INSERT INTO repos (url, name, source_id, interval_min) VALUES ${rows.map(() => "(?, ?, ?, ?)").join(", ")} ON CONFLICT(url) DO NOTHING`)
      .bind(...rows.flatMap((url) => { const u = new URL(url); return [url, u.host + u.pathname.replace(/\.git$/, ""), sourceId, interval]; })));
  }
  if (stmts.length) await env.DB.batch(stmts);
}

/** Claims due repos atomically, so overlapping cron runs never back up the same repo twice. */
const claimDue = async (env: Env, now: number, limit: number) => (await env.DB.prepare(
  "UPDATE repos SET next_run_at = ?1 + interval_min * 60000, started_at = ?1 WHERE id IN (SELECT id FROM repos WHERE paused = 0 AND next_run_at <= ?1 ORDER BY next_run_at LIMIT ?2) RETURNING *",
).bind(now, limit).all<Repo>()).results;

async function handle(req: Request, env: Env, user: string): Promise<Response> {
  const url = new URL(req.url);
  // Show messages only after our own redirects, so a link from elsewhere can't plant a fake status message.
  const flash: Flash = req.headers.get("Sec-Fetch-Site") === "same-origin"
    ? { ok: url.searchParams.get("ok") ?? undefined, err: url.searchParams.get("err") ?? undefined } : {};
  const post = req.method === "POST";
  const form = post ? await req.formData().catch(() => new FormData()) : null;

  if (url.pathname === "/" && !post) {
    const repos = (await env.DB.prepare("SELECT * FROM repos ORDER BY status = 'error' DESC, name").all<Repo>()).results;
    const sources = (await env.DB.prepare("SELECT * FROM sources ORDER BY owner").all<Source>()).results;
    return page(homePage(user, repos, sources, await getSettings(env.DB), isFree(env), flash));
  }

  if (url.pathname === "/settings" && !post) {
    // Only names and GitHub's verdict are shown; token values never leave the Worker except to api.github.com.
    const secrets = env as unknown as Record<string, unknown>;
    const names = Object.keys(secrets).filter((k) => /^GITHUB_TOKEN(_[A-Z0-9_]+)?$/.test(k) && typeof secrets[k] === "string" && secrets[k]).sort();
    const tokens = await Promise.all(names.map(async (name) => ({ name, ...(await checkToken(secrets[name] as string)) })));
    return page(settingsPage(user, await getSettings(env.DB), tokens, isFree(env), flash));
  }

  if (url.pathname === "/settings" && form) {
    if (form.has("retention_days")) {
      const days = parseRetention(form.get("retention_days"));
      if (days == null) return redirect("/settings", { err: "Retention must be a whole number of days from 0 to 3650." });
      await saveSetting(env.DB, "retention_days", days);
      return redirect("/settings", { ok: days ? `Copies are kept for ${days} days; the newest copy of each repository is always kept.` : "Every copy is kept forever." });
    }
    const interval = parseInterval(form.get("every"), form.get("unit"));
    if (!interval) return redirect("/settings", { err: BAD_INTERVAL });
    await saveSetting(env.DB, "default_interval", interval);
    return redirect("/settings", { ok: `New repositories default to ${describeInterval(interval).toLowerCase()}.` });
  }

  if (url.pathname === "/add" && form) {
    const interval = parseInterval(form.get("every"), form.get("unit"));
    const target = parseTarget(String(form.get("target") ?? ""));
    if (!interval) return redirect("/", { err: BAD_INTERVAL });
    if (!target) return redirect("/", { err: "Enter a GitHub user or org (octocat), a repo (octocat/hello-world) or an https git URL." });
    if ("url" in target) {
      await insertRepos(env, [target.url], null, interval);
      // Re-adding a tracked repo applies the schedule just chosen and unpauses it.
      const r = await env.DB.prepare("UPDATE repos SET interval_min = ?, paused = 0 WHERE url = ? RETURNING last_checked_at").bind(interval, target.url).first<{ last_checked_at: number | null }>();
      return redirect("/", { ok: r?.last_checked_at
        ? `${target.url} is now backed up ${describeInterval(interval).toLowerCase()}.`
        : `Added ${target.url}. The first backup starts within 5 minutes.` });
    }
    if (isFree(env)) {
      // Listing a big account can take more than the Free plan's 10 ms of CPU, so the scheduler does it in the background.
      await env.DB.prepare("INSERT INTO sources (owner, interval_min) VALUES (?, ?) ON CONFLICT(owner) DO UPDATE SET interval_min = excluded.interval_min, synced_at = 0, error = NULL")
        .bind(target.owner, interval).run();
      return redirect("/", { ok: `Watching ${target.owner}. Its repositories are listed within 5 minutes, then backed up a few at a time.` });
    }
    let urls: string[];
    try {
      urls = await listOwnerRepos(target.owner, tokenFor(env, target.owner));
    } catch (e) {
      return redirect("/", { err: (e as Error).message });
    }
    const src = await env.DB.prepare(
      "INSERT INTO sources (owner, interval_min, synced_at) VALUES (?, ?, ?) ON CONFLICT(owner) DO UPDATE SET interval_min = excluded.interval_min, synced_at = excluded.synced_at, error = NULL RETURNING id",
    ).bind(target.owner, interval, Date.now()).first<{ id: number }>();
    await insertRepos(env, urls, src!.id, interval);
    return redirect("/", { ok: `Watching ${target.owner}: ${urls.length} repositories. First backups start within 5 minutes; new repos are picked up daily.` });
  }

  const src = url.pathname.match(/^\/source\/(\d+)\/delete$/);
  if (src && form) {
    const s = await env.DB.prepare("DELETE FROM sources WHERE id = ? RETURNING owner").bind(Number(src[1])).first<{ owner: string }>();
    return redirect("/", s ? { ok: `Stopped watching ${s.owner}. Existing copies stay in R2.` } : { err: "Already removed." });
  }

  const m = url.pathname.match(/^\/repo\/(\d+)(?:\/(run|settings|delete|download))?$/);
  const repo = m && (await env.DB.prepare("SELECT * FROM repos WHERE id = ?").bind(Number(m[1])).first<Repo>());
  if (!m || !repo) return page(messagePage("Not found", "That page or repository doesn't exist."), 404);
  const here = `/repo/${repo.id}`;

  if (!m[2] && !post) {
    const copies = (await listCopies(env.BUCKET, prefix(repo))).reverse();
    const owner = repo.source_id
      ? (await env.DB.prepare("SELECT owner FROM sources WHERE id = ?").bind(repo.source_id).first<string>("owner")) : null;
    return page(repoPage(user, repo, copies, owner, flash));
  }

  if (m[2] === "download" && !post) {
    const key = url.searchParams.get("key") ?? "";
    const obj = key.startsWith(prefix(repo)) && !key.slice(prefix(repo).length).includes("/") ? await env.BUCKET.get(key) : null;
    if (!obj) return page(messagePage("Not found", "That copy doesn't exist anymore."), 404);
    return new Response(obj.body, { headers: {
      "Content-Type": "application/x-git-bundle",
      "Content-Length": String(obj.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName(repo, key))}`,
    } });
  }

  if (m[2] === "run" && form) {
    // Push the schedule forward first so the cron doesn't start the same backup in parallel.
    await env.DB.prepare("UPDATE repos SET next_run_at = ?1 + interval_min * 60000, started_at = ?1 WHERE id = ?2").bind(Date.now(), repo.id).run();
    const r = await runBackup(env, repo);
    return redirect(form.get("back") === "/" ? "/" : here, r.ok ? { ok: `${repo.name}: ${r.message}.` } : { err: `${repo.name}: ${r.message}` });
  }

  if (m[2] === "settings" && form) {
    if (form.has("every")) {
      const interval = parseInterval(form.get("every"), form.get("unit"));
      if (!interval) return redirect(here, { err: BAD_INTERVAL });
      await env.DB.prepare("UPDATE repos SET interval_min = ?1, next_run_at = COALESCE(last_checked_at, 0) + ?1 * 60000 WHERE id = ?2").bind(interval, repo.id).run();
      return redirect(here, { ok: `Schedule set: ${describeInterval(interval).toLowerCase()}.` });
    }
    const paused = form.get("paused") === "1" ? 1 : 0;
    await env.DB.prepare("UPDATE repos SET paused = ? WHERE id = ?").bind(paused, repo.id).run();
    return redirect(here, { ok: paused ? "Backups paused." : "Backups resumed." });
  }

  // Repos from a watched owner would be re-added by the daily sync, so the UI only offers pause for them.
  if (m[2] === "delete" && form && !repo.source_id) {
    await env.DB.prepare("DELETE FROM repos WHERE id = ?").bind(repo.id).run();
    return redirect("/", { ok: `Removed ${repo.name}. Its copies stay in your R2 bucket.` });
  }

  return page(messagePage("Not found", "That page doesn't exist."), 404);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === "/app.js") return new Response(APP_JS, { headers: { "Content-Type": "text/javascript; charset=utf-8" } });
    if (url.pathname === "/style.css") return new Response(CSS, { headers: { "Content-Type": "text/css; charset=utf-8" } });

    // The runtime sets ctx.access only for requests that Worker-level Cloudflare Access authenticated.
    if (!ctx.access)
      return page(messagePage("Locked", "Turn on Cloudflare Access for this Worker to use the portal (the Access step in DEPLOY.md)."), 403);
    const identity = await ctx.access.getIdentity().catch(() => undefined);
    const user = identity?.email ?? "signed in";
    if (req.method === "POST" && req.headers.get("Origin") !== url.origin) return new Response("Cross-site request blocked", { status: 403 });

    return handle(req, env, user);
  },

  async scheduled(_controller, env) {
    const now = Date.now();
    const free = isFree(env);

    // Pick up repos created since the last daily sync of each watched owner. Marked synced first, so a run
    // that gets cut off doesn't retry the same listing forever; an error retries in an hour (not every run,
    // which on Free would starve the backups below).
    const stale = (await env.DB.prepare("SELECT * FROM sources WHERE synced_at < ? ORDER BY synced_at LIMIT ?")
      .bind(now - 86_400_000, free ? 1 : 100).all<Source>()).results;
    for (const s of stale) {
      await env.DB.prepare("UPDATE sources SET synced_at = ? WHERE id = ?").bind(now, s.id).run();
      try {
        await insertRepos(env, await listOwnerRepos(s.owner, tokenFor(env, s.owner)), s.id, s.interval_min);
        await env.DB.prepare("UPDATE sources SET error = NULL WHERE id = ?").bind(s.id).run();
      } catch (e) {
        await env.DB.prepare("UPDATE sources SET error = ?, synced_at = ? WHERE id = ?").bind((e as Error).message, now - 86_400_000 + 3_600_000, s.id).run();
      }
    }
    if (free && stale.length) return; // Free plan: that listing used this run's CPU; backups continue next run

    if (free) {
      // Unchanged checks are cheap but saving a copy isn't, so stop after the first new copy.
      for (let i = 0; i < FREE.checksPerRun; i++) {
        const [r] = await claimDue(env, now, 1);
        if (!r || (await runBackup(env, r)).saved) break;
      }
      return;
    }
    const due = await claimDue(env, now, 20);
    await Promise.all(Array.from({ length: 4 }, async () => {
      for (let r; (r = due.shift()); ) await runBackup(env, r);
    }));
  },
} satisfies ExportedHandler<Env>;
