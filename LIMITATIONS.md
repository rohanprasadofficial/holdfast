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
- **One backup has a time limit** (15 minutes on a schedule, 5 minutes of CPU). Very large repos, around several GB,
  may not finish. They show as **Interrupted** and are retried on schedule.
- **Each new copy is a full copy,** not just the changes since the last one. A large repo that changes often uses
  more storage. Retention (Settings) controls how long old copies stay.
- **All times are shown in UTC.**

## Trust and security

- **Your code is stored in your own Cloudflare account,** encrypted at rest by R2. It is not end-to-end encrypted:
  anyone with access to that Cloudflare account can read the copies.
- **Anyone who passes your Cloudflare Access policy** can see and download every copy. There are no per-user permissions.
- **If your Cloudflare account is compromised,** copies can be deleted, unless you add the optional R2 bucket lock
  (DEPLOY.md, security checklist).
- **Holdfast never writes to GitHub,** and its tokens should be read-only.

## Cost

- **Workers Paid plan** ($5/month) is required for the CPU time large backups need.
- **R2 and D1** usually stay inside their free tiers for personal use (R2: 10 GB stored). Large or busy
  accounts pay standard R2 storage rates. R2 has no download (egress) fees.

## Not built yet

Email alerts on failure, backups of issues and pull requests, Git LFS, private repos on other hosts,
saving only the changes between copies, and per-user permissions.
