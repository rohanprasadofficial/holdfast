import { STALE_MS, repoState, type Repo } from "./backup.ts";
import { UNITS, describeInterval, splitInterval } from "./schedule.ts";
import type { Settings } from "./settings.ts";

export type Source = { id: number; owner: string; interval_min: number; synced_at: number; error: string | null };
export type Flash = { ok?: string; err?: string };
export type TokenStatus = { name: string; ok: boolean; login?: string; expires?: string | null; detail?: string };
type Html = { __html: string };

// Tagged template that escapes every interpolated value unless it is already Html.
const raw = (s: string): Html => ({ __html: s });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const render = (v: unknown): string =>
  v == null || v === false ? "" : Array.isArray(v) ? v.map(render).join("")
  : typeof v === "object" && "__html" in v ? (v as Html).__html : esc(String(v));
const html = (strings: TemplateStringsArray, ...vals: unknown[]): Html =>
  raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? render(vals[i]) : ""), ""));

const short = (name: string) => name.split("/").slice(1).join("/");
const host = (name: string) => name.split("/")[0];
export const fileName = (repo: Repo, key: string) => `${repo.name.split("/").pop()}-${key.split("/").pop()}`;

function ago(ms: number | null) {
  if (!ms) return "never";
  const d = Math.round((Date.now() - ms) / 1000), a = Math.abs(d);
  if (a < 60) return d < 0 ? "in a moment" : "just now";
  const [n, u] = a < 3600 ? [Math.round(a / 60), "m"] : a < 86400 ? [Math.round(a / 3600), "h"] : [Math.round(a / 86400), "d"];
  return d < 0 ? `in ${n}${u}` : `${n}${u} ago`;
}
const fmtDate = (ms: number) =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(ms) + " UTC";
function fmtBytes(n: number | null) {
  if (n == null) return "—";
  let i = 0;
  for (; n >= 1024 && i < 4; i++) n /= 1024;
  return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${["B", "KB", "MB", "GB", "TB"][i]}`;
}
const when = (ms: number | null) =>
  ms ? html`<time datetime="${new Date(ms).toISOString()}" title="${fmtDate(ms)}">${ago(ms)}</time>` : "never";
const nextRun = (r: Repo) => (r.paused ? "paused" : r.next_run_at <= Date.now() ? "within 5 min" : ago(r.next_run_at));

const INTERRUPTED = `The last backup started ${STALE_MS / 60_000}+ minutes ago and never finished, usually because the repo is too large for one run. It is retried on schedule; existing copies are untouched.`;
function status(r: Repo) {
  switch (repoState(r)) {
    case "running": return html`<span class="status queued">Running</span>`;
    case "interrupted": return html`<span class="status error" title="${INTERRUPTED}">Interrupted</span>`;
    case "paused": return html`<span class="status">Paused</span>`;
    case "ok": return html`<span class="status ok">Healthy</span>`;
    case "error": return html`<span class="status error" title="${r.error}">Failing</span>`;
    default: return html`<span class="status queued">Queued</span>`;
  }
}

/** "every [N] [minutes|hours|days]" inputs; the server enforces 5 minutes to 365 days. */
function everyFields(min: number) {
  const [n, unit] = splitInterval(min);
  return html`<span class="every"><span>Every</span>
    <input name="every" type="number" min="1" step="1" value="${n}" required aria-label="Interval">
    <select name="unit" aria-label="Unit">${Object.keys(UNITS).map((u) => html`<option${u === unit ? raw(" selected") : ""}>${u}</option>`)}</select></span>`;
}

// Mark: the original (half disc) and its kept copy (block).
const MARK = `<path d="M14.5 5a11 11 0 0 0 0 22z" fill="#ff5e1f"/><rect x="17.5" y="5" width="11" height="22" class="k"/>`;
const LOGO = (size = 24) => raw(`<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true" fill="currentColor">${MARK}</svg>`);
const FAVICON = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>.k{fill:#171717}@media(prefers-color-scheme:dark){.k{fill:#f0e3de}}</style>${MARK}</svg>`,
)}`;
// Gear drawn as a dashed ring (the teeth) around a ring with a hole.
const GEAR = raw(`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="8.6" stroke-width="2.6" stroke-dasharray="3.4 3.35"/><circle cx="12" cy="12" r="6.4" stroke-width="1.6"/><circle cx="12" cy="12" r="2.3" stroke-width="1.6"/></svg>`);

// Hero diagram in the style of Cloudflare product pages: repos (dashed nodes) → Holdfast → R2.
const port = (x: number, y: number, c = "p") => `<rect class="${c}" x="${x - 4}" y="${y - 4}" width="8" height="8" rx="2"/>`;
export const DIAGRAM = raw(`<svg class="diagram" viewBox="0 0 640 150" aria-hidden="true">
<path class="wire" d="M120 44C200 44 200 75 280 75M120 106C200 106 200 75 280 75"/>
<path class="wire hot" d="M368 75H512"/>
<rect class="node" x="68" y="18" width="52" height="52" rx="8"/>${port(120, 44)}
<path class="ico" d="M88 34v20M101 40c0 7-13 5-13 14"/><circle class="ico" cx="88" cy="31" r="3"/><circle class="ico" cx="88" cy="57" r="3"/><circle class="ico" cx="101" cy="37" r="3"/>
<rect class="node" x="68" y="80" width="52" height="52" rx="8"/>${port(120, 106)}
<path class="ico" d="M85 96h16v20H85zM89 96v20"/>
<text class="tag-t" x="324" y="20" text-anchor="middle">Holdfast</text>
<rect class="vault" x="280" y="31" width="88" height="88" rx="10"/><rect class="vault-in" x="288" y="39" width="72" height="72" rx="6"/>
${port(280, 75, "p hot")}${port(368, 75, "p hot")}
<g transform="translate(304 55) scale(1.25)" fill="currentColor">${MARK}</g>
<rect class="node" x="512" y="45" width="60" height="60" rx="8"/>${port(512, 75)}
<ellipse class="ico" cx="542" cy="66" rx="12" ry="4"/><path class="ico" d="M530 66v18a12 4 0 0 0 24 0V66M530 75a12 4 0 0 0 24 0"/>
<text class="cap" x="94" y="146" text-anchor="middle">GitHub · any git</text><text class="cap" x="542" y="124" text-anchor="middle">R2 bucket</text>
</svg>`);

export const DISCLAIMER = "Holdfast is an independent open-source project. It is not affiliated with, endorsed by or sponsored by Cloudflare, Inc. or GitHub, Inc.";

export function layout(title: string, user: string, body: Html, flash: Flash = {}) {
  const note = flash.err ?? flash.ok;
  return html`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Holdfast</title>
<link rel="icon" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="/style.css">
<script src="/app.js" defer></script>
</head><body>
<header class="top">
  <a class="brand" href="/">${LOGO()}<span>Holdfast</span></a>
  ${user ? html`<nav class="nav"><a class="icon-btn" href="/settings" aria-label="Settings" title="Settings">${GEAR}</a>
    <span class="who" title="Signed in with Cloudflare Access">${user}</span></nav>` : ""}
</header>
<main>
  ${note ? html`<div class="band"><div class="col"><div class="flash${flash.err ? " err" : ""}" role="${flash.err ? "alert" : "status"}">${note}</div></div></div>` : ""}
  ${body}
  <div class="band fill"><div class="col"></div></div>
</main>
<footer class="band"><div class="col foot"><p>${DISCLAIMER}</p><span>Copies are stored in your own R2 bucket</span></div></footer>
</body></html>`;
}

const stat = (label: string, value: unknown, alert = false) =>
  html`<div class="cell stat${alert ? " alert" : ""}"><span class="label">${label}</span><b>${value}</b></div>`;

const sourceTag = (s: Source) => html`
  <form class="tag${s.error ? " bad" : ""}" method="post" action="/source/${s.id}/delete"
    data-confirm="Stop watching ${s.owner}? Its repos leave the portal; existing copies stay in R2."
    title="${s.error ?? (s.synced_at ? `Checked for new repos ${ago(s.synced_at)}` : "Listing repos within 5 minutes")}">
    <span>${s.owner}</span><button aria-label="Stop watching ${s.owner}">×</button>
  </form>`;

const repoRow = (r: Repo) => html`
  <tr data-name="${r.name.toLowerCase()}">
    <td><a class="repo-link" href="/repo/${r.id}">${short(r.name)}</a><span class="host">${host(r.name)}</span></td>
    <td class="muted hide-sm">${describeInterval(r.interval_min)}</td>
    <td class="muted hide-sm">${when(r.last_saved_at)}${r.size != null ? html` · ${fmtBytes(r.size)}` : ""}</td>
    <td>${status(r)}</td>
    <td class="right hide-sm"><form method="post" action="/repo/${r.id}/run" data-busy="Backing up…">
      <input type="hidden" name="back" value="/"><button class="btn line sm">Back up now</button></form></td>
  </tr>`;

export function homePage(user: string, repos: Repo[], sources: Source[], settings: Settings, flash: Flash) {
  const states = repos.map((r) => repoState(r));
  const failing = states.filter((s) => s === "error" || s === "interrupted").length;
  const healthy = states.filter((s) => s === "ok").length;
  const stored = repos.reduce((n, r) => n + (r.size ?? 0), 0);
  return layout("Repositories", user, html`
  <section class="band"><div class="col">
    <div class="hero">
      ${DIAGRAM}
      <h1>Hold fast to every repository.</h1>
      <p>Holdfast mirrors your git repositories into your own R2 bucket on the schedule you choose. Every branch, tag and commit, restorable with one <code>git clone</code>.</p>
    </div>
    <form class="cells add" method="post" action="/add" data-busy="Adding…">
      <label class="cell field"><span class="label">GitHub user, organization or repository</span>
        <input name="target" required autocomplete="off" spellcheck="false" placeholder="octocat, octocat/hello-world or https://…"></label>
      <div class="cell field"><span class="label">Schedule</span>${everyFields(settings.default_interval)}</div>
      <div class="cell go"><button class="btn">Start backing up</button></div>
    </form>
    <div class="cells c4 flush">
      ${stat("Repositories", repos.length)}${stat("Healthy", healthy)}${stat("Failing", failing, failing > 0)}${stat("Latest copies", fmtBytes(stored))}
    </div>
  </div></section>

  <section class="band"><div class="col">
    <div class="head">
      <div><span class="tag static">Repositories</span><h2>${repos.length} tracked</h2></div>
      ${repos.length > 5 ? html`<input class="filter" type="search" placeholder="Filter repositories" aria-label="Filter repositories" data-filter>` : ""}
    </div>
    ${sources.length ? html`<div class="watching"><span class="label">Watching</span>${sources.map(sourceTag)}</div>` : ""}
    <div class="cells flush"><div class="cell">
      ${repos.length
        ? html`<div class="scroll"><table><thead><tr><th>Repository</th><th class="hide-sm">Schedule</th><th class="hide-sm">Last copy</th><th>Status</th><th class="hide-sm"></th></tr></thead>
            <tbody>${repos.map(repoRow)}</tbody></table></div>`
        : html`<div class="empty">${LOGO(40)}<p><b>No repositories yet</b><br>${sources.length
            ? "The repos of the accounts you're watching are listed within 5 minutes."
            : "Add a GitHub user or organization above and every repo they own is backed up."}</p></div>`}
    </div></div>
  </div></section>`, flash);
}

export function repoPage(user: string, repo: Repo, copies: R2Object[], owner: string | null, flash: Flash) {
  const base = repo.name.split("/").pop()!;
  const file = copies[0] ? fileName(repo, copies[0].key) : `${base}.bundle`;
  const restore = `# working copy with full history\ngit clone ${file} ${base}\n\n# or move everything to a new remote\ngit clone --mirror ${file} ${base}.git\ncd ${base}.git\ngit push --mirror <new-remote-url>`;
  const state = repoState(repo);
  return layout(short(repo.name), user, html`
  <section class="band"><div class="col">
    <div class="page-head">
      <div>
        <a class="crumb" href="/">← All repositories</a>
        <span class="tag static">${host(repo.name)}${owner ? ` · from ${owner}` : ""}</span>
        <h1>${short(repo.name)}</h1>
        <a class="src" href="${repo.url}" target="_blank" rel="noopener noreferrer">${repo.url} ↗</a>
      </div>
      <div class="head-actions">${status(repo)}
        <form method="post" action="/repo/${repo.id}/run" data-busy="Backing up…"><button class="btn">Back up now</button></form>
      </div>
    </div>
    ${state === "interrupted" ? html`<div class="cells"><div class="cell error-box"><span class="tag static bad">Interrupted · started ${ago(repo.started_at)}</span>
      <p>${INTERRUPTED}</p></div></div>`
    : state === "error" ? html`<div class="cells"><div class="cell error-box"><span class="tag static bad">Last error · ${ago(repo.last_checked_at)}</span>
      <p>${repo.error}</p><p class="muted small">Retries automatically.</p></div></div>` : ""}
    <div class="cells split flush">
      <section class="cell timeline-cell">
        <div class="cell-head"><h3>Timeline</h3><span class="label">${copies.length} ${copies.length === 1 ? "copy" : "copies"}</span></div>
        ${copies.length
          ? html`<ol class="timeline">${copies.map((c, i) => html`<li>
              <div><div class="when">${fmtDate(c.uploaded.getTime())}${i === 0 ? html`<span class="badge">Latest</span>` : ""}</div>
              <div class="meta">${ago(c.uploaded.getTime())} · ${fmtBytes(c.size)}</div></div>
              <a class="btn line sm" href="/repo/${repo.id}/download?key=${encodeURIComponent(c.key)}">Download</a></li>`)}</ol>`
          : html`<div class="empty"><p><b>No copies yet</b><br>${repo.paused ? "Backups are paused." : `First backup runs ${nextRun(repo)}.`}</p></div>`}
      </section>
      <section class="cell pad">
        <h3 class="label">Schedule</h3>
        <form class="row" method="post" action="/repo/${repo.id}/settings">
          ${everyFields(repo.interval_min)}
          <button class="btn line">Save</button>
        </form>
        <p class="muted small">Checked ${when(repo.last_checked_at)} · next ${nextRun(repo)}</p>
        <div class="row">
          <form method="post" action="/repo/${repo.id}/settings"><input type="hidden" name="paused" value="${repo.paused ? 0 : 1}">
            <button class="btn line sm">${repo.paused ? "Resume backups" : "Pause backups"}</button></form>
          ${repo.source_id ? "" : html`<form method="post" action="/repo/${repo.id}/delete"
            data-confirm="Remove ${short(repo.name)} from the portal? Its copies stay in your R2 bucket.">
            <button class="btn danger sm">Remove</button></form>`}
        </div>
      </section>
      <section class="cell pad alt">
        <h3 class="label">Restore</h3>
        <p class="small">Each copy is a standard git bundle with every branch, tag and commit.</p>
        <pre>${restore}</pre>
      </section>
    </div>
  </div></section>`, flash);
}

function tokenRow(t: TokenStatus) {
  const owner = t.name === "GITHUB_TOKEN" ? "Default: your repos, and any owner without its own token" : `Owner: ${t.name.slice(13).toLowerCase().replace(/_/g, "-")}`;
  const expiresAt = t.expires ? Date.parse(t.expires.replace(" UTC", "Z").replace(" ", "T")) : NaN;
  const soon = expiresAt - Date.now() < 14 * 86_400_000;
  return html`<li><div><code>${t.name}</code><span class="muted small">${owner}</span></div>
    ${!t.ok ? html`<span class="status error">${t.detail}</span>`
    : html`<span class="status ${soon ? "queued" : "ok"}">${t.login} · ${t.expires ? `expires ${ago(expiresAt)}` : "no expiry date"}</span>`}</li>`;
}

export function settingsPage(user: string, settings: Settings, tokens: TokenStatus[], flash: Flash) {
  return layout("Settings", user, html`
  <section class="band"><div class="col">
    <div class="page-head"><div>
      <a class="crumb" href="/">← All repositories</a>
      <span class="tag static">Settings</span>
      <h1>Settings</h1>
      <p class="muted">These apply to the whole portal. Each repository's own schedule is set on its page.</p>
    </div></div>
    <div class="cells rows flush">
      <div class="cell pad"><h3>Retention</h3>
        <p class="muted small">A new copy is saved only when a branch or tag changed. Copies older than this are deleted after the next new copy.
        The newest copy of every repository is always kept. Set 0 to keep everything forever.</p></div>
      <div class="cell pad"><form class="row" method="post" action="/settings">
        <span class="every"><span>Keep copies for</span><input name="retention_days" type="number" min="0" max="3650" step="1" value="${settings.retention_days}" required aria-label="Days"><span>days</span></span>
        <button class="btn line">Save</button></form></div>

      <div class="cell pad"><h3>Default schedule</h3>
        <p class="muted small">Pre-filled when you add a repository or account. Each one keeps the schedule it was added with, and you can change it on its page.</p></div>
      <div class="cell pad"><form class="row" method="post" action="/settings">${everyFields(settings.default_interval)}<button class="btn line">Save</button></form></div>

      <div class="cell pad"><h3>GitHub tokens</h3>
        <p class="muted small">Read-only tokens for private repositories, one per account or organization. Values are never shown.
        Add one with <code>npx wrangler secret put GITHUB_TOKEN_&lt;ORG&gt;</code>; see DEPLOY.md.</p></div>
      <div class="cell pad">${tokens.length
        ? html`<ul class="tokens">${tokens.map(tokenRow)}</ul>`
        : html`<p class="muted small">No token is set, so only public repositories can be backed up and GitHub limits listing to 60 requests an hour.</p>`}</div>
    </div>
  </div></section>`, flash);
}

export const messagePage = (title: string, text: string) =>
  layout(title, "", html`<section class="band"><div class="col"><div class="message">${LOGO(36)}<h1>${title}</h1><p>${text}</p></div></div></section>`);

export const APP_JS = `
document.addEventListener("submit", (e) => {
  const f = e.target, b = f.querySelector("button");
  if (f.dataset.confirm && !confirm(f.dataset.confirm)) return e.preventDefault();
  if (f.dataset.busy && b) { b.disabled = true; b.textContent = f.dataset.busy; }
});
document.querySelector("[data-filter]")?.addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  for (const tr of document.querySelectorAll("tr[data-name]")) tr.hidden = !tr.dataset.name.includes(q);
});
if (location.search) history.replaceState(null, "", location.pathname);
`;
