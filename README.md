# Holdfast

Self-hosted backups of your GitHub repos, running entirely on your own Cloudflare account.

- Add a GitHub **user or organization** (all their repos, plus new ones picked up daily), a **single repo**, or **any public https git URL** (GitLab, Gitea and others).
- Pick any schedule per repo, from every 5 minutes to every 365 days.
- Each backup is a standard **git bundle** with full history, every branch and tag, stored in **R2**. Restore with `git clone backup.bundle`.
- A copy is only saved when something changed. Old copies expire after the retention set in **Settings** (30 days by default), and the newest copy of each repo is always kept.
- A repo deleted upstream or a force-push never deletes your copies.
- Login is handled by **Cloudflare Access**. No passwords to manage.

## Deploy

Give your coding agent (Claude Code, Codex, Cursor…) this prompt:

> Deploy Holdfast to my Cloudflare account. Clone https://github.com/rohanprasadofficial/holdfast and follow DEPLOY.md in it step by step. Ask me which Cloudflare account and which GitHub accounts to back up, and stop whenever a step needs me.

Works on the Workers Free plan in free mode (repos up to 25 MB, two every 5 minutes), or without limits on
Workers Paid ($5/month). The agent does everything else. You approve three things: the Cloudflare login, a read-only GitHub token
(from a pre-filled link), and the Access sign-in. [`DEPLOY.md`](DEPLOY.md) also works by hand.

## How it works

No servers, containers or `git` binary. A Worker speaks git's smart-HTTP protocol directly:
it asks GitHub for the list of branches and tags, and if anything changed since the last copy it downloads one
packfile containing every object and streams it into R2 as a bundle.

| Piece | Role |
|---|---|
| Worker (`src/`) | portal pages + backup logic |
| Cron trigger | every 5 min, backs up repos that are due (up to 20 per run, 4 at a time) |
| D1 | repos, schedules, status |
| R2 | `repos/<host>/<owner>/<repo>/<timestamp>.bundle` |
| Cloudflare Access | Worker-level sign-in; the Worker refuses any request Access didn't authenticate |

## Private repos and security

- **Private repos:** add a read-only fine-grained GitHub token per owner: `GITHUB_TOKEN` for you and
  `GITHUB_TOKEN_<ORG>` per organization. Steps are in [`DEPLOY.md`](DEPLOY.md#5-github-tokens-read-only). The **Settings** page shows each token's owner and expiry date.
- **Sign-in:** Worker-level Cloudflare Access. The Worker refuses any request that Access didn't authenticate, so a
  missing or disabled policy locks the portal instead of opening it.
- **Tokens:**
  - stored as encrypted Worker secrets, never in D1, R2, logs or URLs
  - sent only to `https://github.com`, and only the token of that repo's owner
  - never carried through a redirect to another host
- **Your code:** R2 encrypts it at rest. The bucket is never public, and downloads only go through the Worker behind Access.
  An optional R2 bucket lock makes recent copies undeletable.
- **The portal:**
  - every value in the HTML is escaped
  - no inline scripts (strict CSP)
  - forms only accept same-origin posts
  - the pages can't be framed
- **Deletions:** none upstream ever propagate. Old copies are pruned only by age, and the newest copy is always kept.
- **Dependencies:** none at runtime.

## Develop

```sh
npm install
cp .dev.vars.example .dev.vars      # optional: add a GITHUB_TOKEN for private repos
npx wrangler d1 migrations apply DB --local
npm run dev                          # http://localhost:8787, Access simulated by "access.dev" in wrangler.jsonc
curl http://localhost:8787/cdn-cgi/handler/scheduled   # run the scheduler once
npm test && npm run check
```

## Website

`site/` is a static landing page with the copy-this-prompt install. Set your domain in `site/wrangler.jsonc`, then
run `npm run site:deploy`. `npm run site:dev` previews it. Forks: replace `rohanprasadofficial` in
`site/public/index.html`, `DEPLOY.md` and this README.

## Limits

Only git data is saved (no issues, PRs or LFS files), private repos work on GitHub only, very large repos may
not finish in one run, and free mode caps repos at 25 MB. Read [LIMITATIONS.md](LIMITATIONS.md) before relying on it.

---

Holdfast is an independent open-source project. It is not affiliated with, endorsed by or sponsored by
Cloudflare, Inc. or GitHub, Inc. MIT licensed.
