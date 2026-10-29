# Deploy Holdfast

> **For coding agents.** The user handed you this file (or a prompt pointing to it) to deploy Holdfast to *their*
> Cloudflare account. Do every step yourself. Only steps marked **👤 Human** need the user. For those, give them a
> direct link and exactly what to click, then wait. Never ask for, print, log or commit a GitHub token or other secret.
> If a command fails, show the error and fix the cause before moving on.

**What gets created:** one Worker (`holdfast`), one D1 database, one R2 bucket, one Cloudflare Access policy.
**Cost:** Workers Paid ($5/month) is recommended. The Workers Free plan also works, in free mode with limits (step 3).
D1 and R2 usually stay inside their free tiers either way.
**The user approves three things:** the Cloudflare login, a read-only GitHub token, and the Access sign-in. On a new
Cloudflare account they also turn on R2 (step 3) and Zero Trust (step 4) once. Both have free tiers, but the dashboard
asks for a payment method.

## 0. Get the code

Skip this if you are already inside the `holdfast` repository.

```sh
git clone https://github.com/rohanprasadofficial/holdfast && cd holdfast
```

## 1. Ask the user two questions up front

1. **Which GitHub accounts and organizations should be backed up?** For example `octocat, acme-inc`.
   Every repo they own is included, and new repos are picked up daily.
2. **How often?** Default: once a day. Anything from every 5 minutes to every 365 days works.

Keep the answers; you use them in steps 5 and 7.

## 2. Install and log in

```sh
npm install
npx wrangler whoami || npx wrangler login
```

**👤 Human:** approve the Cloudflare login in the browser window that opens.

Run `npx wrangler whoami` again. If it lists more than one account, **ask the user which one**, then add
`"account_id": "<id>"` to `wrangler.jsonc`. Remember the account ID for the links in steps 5 and 6.

## 3. Create storage and deploy

```sh
npx wrangler r2 bucket create holdfast
npx wrangler d1 create holdfast
```

**If the bucket create fails because R2 isn't enabled** (code 10042), **👤 Human:** open
`https://dash.cloudflare.com/<account_id>/r2/overview` and turn on R2 (free tier: 10 GB). Then run the command again.

Copy the `database_id` from the `d1 create` output into `wrangler.jsonc` → `d1_databases[0].database_id`
(keep the existing `binding`, `database_name` and `migrations_dir`). Then:

```sh
npm run migrate
npm run deploy
```

Note the `https://holdfast.<subdomain>.workers.dev` URL. Opening it now shows **"Locked"**, which is expected.
If wrangler asks to register a workers.dev subdomain first, ask the user for a name.

**If the deploy fails with `CPU limits are not supported for the Free plan`,** the account is on Workers Free.
The R2 bucket and D1 database are fine. **Ask the user** which they want, and tell them the trade-off:

- **Upgrade to Workers Paid** ($5/month), **recommended**. No size cap, up to 20 repos per run, and every backup
  runs within its CPU limit. Send them to `https://dash.cloudflare.com/<account_id>/workers/plans`, wait until
  they're done, then run `npm run deploy` again.
- **Free mode** (no cost). Each run gets 10 ms of CPU, so free mode saves at most one new copy every 5 minutes and
  skips GitHub repos larger than 50 MB, telling the user so in the portal. **Risk:** saving a copy takes more than
  10 ms (about 2 ms per MB), so it relies on Cloudflare tolerating occasional overruns. That is Cloudflare's policy,
  not a guarantee; LIMITATIONS.md has the measurements. In `wrangler.jsonc`, delete the `"limits"` line and set
  `"vars": { "PLAN": "free" }`, then run `npm run deploy` again.

## 4. Lock it with Cloudflare Access

**👤 Human:** open `https://dash.cloudflare.com/<account_id>/workers/services/view/holdfast/production` and then:
1. Open the **Access** tab, then click **Protect this Worker behind Access**.
2. Choose **All traffic**.
3. Allow **Cloudflare account** (members of this account) or add specific emails. Never pick *Email domain* with a
   public domain like `gmail.com`, because that lets anyone with such an address in.
4. Click **Apply Access**. The first time, the dashboard asks to set up Zero Trust: pick any team name and the
   **Zero Trust Free** plan (50 users). It asks for payment details but doesn't charge for the Free plan.

This covers every URL of the Worker. The Worker refuses anything Access didn't authenticate, so if Access is ever
turned off, the portal locks itself.

## 5. GitHub tokens (read-only)

One fine-grained token per owner from step 1, because a token can only read one account's or one org's repos.
Build one link per owner (replace `<owner>`):

```
https://github.com/settings/personal-access-tokens/new?name=Holdfast%20backups&description=Read-only%20access%20for%20Holdfast%20backups&target_name=<owner>&expires_in=366&contents=read
```

**👤 Human**, for each link:
1. Open it. Name, owner, expiry and **Contents: Read-only** are already filled in.
2. Under **Repository access**, choose **All repositories**, then click **Generate token**.
3. Open a **separate terminal window** (not the agent's shell, so the token never enters the agent's transcript),
   then paste the token when asked. Give the user the exact commands with the real folder path:
   ```sh
   cd <path to holdfast>
   npx wrangler secret put GITHUB_TOKEN              # for your own account
   npx wrangler secret put GITHUB_TOKEN_ACME_INC     # for the org acme-inc: uppercase, "-" becomes "_"
   ```

Some organizations must approve tokens first. An org owner approves it under
**Organization settings → Personal access tokens → Pending requests**.

## 6. Add the accounts to back up

Insert each owner from step 1, with the interval in minutes (1440 = daily). The values go into SQL, so only use
owner names matching `^[A-Za-z0-9-]{1,39}$` and whole-number intervals from 5 to 525600, and refuse anything else:

```sh
npx wrangler d1 execute DB --remote --command "INSERT INTO sources (owner, interval_min) VALUES ('octocat', 1440), ('acme-inc', 1440) ON CONFLICT(owner) DO NOTHING"
```

Within 5 minutes the scheduler lists their repos, and backups start on their own.

## 7. Verify

**👤 Human:** open the workers.dev URL and sign in through Access. Then:
1. **Settings** (gear icon): every token shows its GitHub login and expiry date.
2. **Home:** within about 5 minutes the repos appear, then turn **Healthy** as their first copies land. Workers
   Paid saves up to 20 repos per run (about 240 an hour). Free mode saves one per run, so 100 repos take about 8 hours.
3. Optional: open a repo, **Download** a copy and run `git clone <file>.bundle test-restore`.

## 8. Security checklist

Walk the user through these before calling the deployment finished:

1. **Access policy** allows only people who should see the code.
2. **The R2 bucket stays private.** Never turn on its public `r2.dev` URL or attach a custom domain to the bucket.
3. **Optional: make copies undeletable** for N days, even for someone holding the Cloudflare credentials.
   Use the same N as Retention in Settings:
   ```sh
   npx wrangler r2 bucket lock add holdfast keep-copies repos/ --retention-days 30
   ```
4. **Tokens are read-only and expire.** Put a calendar reminder a week before the expiry date shown in Settings.
5. **Log the agent out** if this machine shouldn't keep Cloudflare access: `npx wrangler logout`.

---

## Updating later

```sh
git pull --autostash && npm install && npm run migrate && npm run deploy
```

`--autostash` keeps your edits to `wrangler.jsonc`. If it reports a conflict there, keep your `account_id`,
`database_id`, `limits` and `PLAN` values.

## Switching to Workers Paid

After upgrading the account, put back `"limits": { "cpu_ms": 300000 }` in `wrangler.jsonc`, set
`"vars": { "PLAN": "paid" }`, and run `npm run deploy`. Repos skipped as too large are backed up on their next run.

## Settings

Retention (default 30 days, newest copy always kept) and the default schedule are on the portal's **Settings**
page. Each repo's schedule is on its own page. The scheduler wakes every 5 minutes (`triggers.crons` in `wrangler.jsonc`).

## Custom domain for the portal

Add a custom domain to the Worker (Settings → Domains & Routes). Worker-level Access already covers it.
Optionally set `"workers_dev": false` in `wrangler.jsonc` and redeploy, so the custom domain is the only way in.

See [LIMITATIONS.md](LIMITATIONS.md) for what Holdfast does not do yet.
