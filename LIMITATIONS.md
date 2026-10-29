# Limitations and risks

Holdfast is small on purpose. This is what it does not do yet, and what to keep in mind.

## What is not backed up

- **Only git data is saved:** every branch, every tag and HEAD. Issues, pull requests, comments, wikis,
  releases, Actions settings and project boards are **not** saved.
- **Git LFS files** are not saved. The pointer files are, but not the large files they point to.
- **GitHub's `refs/pull/*` refs** are skipped. A pull request's commits are only kept if they are on a branch or tag.

## Private repositories

- **GitHub:** supported with read-only fine-grained tokens, one per user or organization (see DEPLOY.md).
- **GitLab, Gitea, Forgejo, Bitbucket and other hosts:** only **public** repos work for now. Each host signs in
  differently, and no token is ever sent to a host other than github.com.
- **An expired token** stops backups of that owner's private repos. The repos show "Access refused", the Settings
  page shows the token as rejected, and existing copies are kept. Nobody is emailed.

## Size and timing

- **Schedules go down to every 5 minutes,** because the scheduler wakes every 5 minutes. A repo runs within
  5 minutes of being due.
- **Up to 20 repos start per 5-minute run.** The very first backup of a large account is spread over a while
  (about 240 repos an hour).
- **One backup has a time limit.** Scheduled runs get 15 minutes in total and 30 seconds of CPU; **Back up now**
  gets up to 5 minutes of CPU. Very large repos, around several GB, may not finish. They show as **Interrupted**
  and are retried on schedule.
- **Each new copy is a full copy,** not just the changes since the last one. A large repo that changes often uses
  more storage. Retention (Settings) controls how long old copies stay.
- **All times are shown in UTC.**

## Workers Free plan (free mode)

Holdfast also runs on the Workers Free plan. Each run then gets only **10 ms of CPU time**, so free mode is
deliberately small:

- **At most one new copy is saved every 5 minutes.** Unchanged repos are cheap, so up to 4 are checked per run
  (about 1,150 checks a day). Many repos on short schedules will run late.
- **GitHub repositories larger than 50 MB are skipped.** They show "Too large for the Workers Free plan". Repos on
  other hosts can't be measured first; if one is too big, it shows as **Interrupted**.
- **Watched accounts are listed in the background,** one per run. Very large organizations (hundreds of repos) may
  not finish listing within the CPU limit.

**Saving a copy goes over 10 ms.** Measured on a real Free account (October 2026), CPU time per run:

| Run | CPU time |
| --- | --- |
| Nothing due, or repo unchanged | 1–3 ms |
| Save a 1 MB repo | 8 ms |
| Save a 10 MB repo | 22 ms |
| Save a 23 MB repo | 39 ms |
| Save a 51 MB repo | 98 ms |

Every one of those runs succeeded, because Cloudflare tolerates occasional overruns on the Free plan. That is
Cloudflare's policy, not a guarantee: it can change, and an account that overruns on every run may be cut off. A
run that is stopped shows as **Interrupted**, keeps the existing copies, and is retried on schedule. For backups you
depend on, use Workers Paid.

Upgrading to Workers Paid removes all of this (DEPLOY.md, "Switching to Workers Paid").

## Trust and security

- **Your code is stored in your own Cloudflare account,** encrypted at rest by R2. It is not end-to-end encrypted:
  anyone with access to that Cloudflare account can read the copies.
- **Anyone who passes your Cloudflare Access policy** can see and download every copy. There are no per-user permissions.
- **If your Cloudflare account is compromised,** copies can be deleted, unless you add the optional R2 bucket lock
  (DEPLOY.md, security checklist).
- **Holdfast never writes to GitHub,** and its tokens should be read-only.

## Cost

- **Workers Free:** $0, in free mode with the limits above.
- **Workers Paid** ($5/month): no free-mode limits, and large repos stream straight into storage.
- **R2 and D1** usually stay inside their free tiers for personal use (R2: 10 GB stored). Large or busy
  accounts pay standard R2 storage rates. R2 has no download (egress) fees.

## Not built yet

Email alerts on failure, backups of issues and pull requests, Git LFS, private repos on other hosts,
saving only the changes between copies, and per-user permissions.
