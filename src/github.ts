/** What the user typed: a GitHub owner ("octocat"), a GitHub repo ("octocat/hello"), or any https git URL. */
export function parseTarget(input: string): { owner: string } | { url: string } | null {
  const s = input.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  if (/^[A-Za-z0-9-]{1,39}$/.test(s)) return { owner: s };
  if (/^[A-Za-z0-9-]{1,39}\/[\w.-]+$/.test(s)) return { url: `https://github.com/${s}` };
  let u: URL;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  // Credentials in the URL would end up stored in D1; tokens belong in secrets.
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const parts = u.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
  if (u.hostname === "github.com" || u.hostname === "www.github.com") {
    if (parts.length === 1 && /^[A-Za-z0-9-]{1,39}$/.test(parts[0])) return { owner: parts[0] };
    // also accepts pasted deep links like /owner/repo/tree/main
    return parts.length >= 2 ? { url: `https://github.com/${parts[0]}/${parts[1].replace(/\.git$/, "")}` } : null;
  }
  return parts.length ? { url: `https://${u.host}/${parts.join("/")}` } : null;
}

/**
 * Token for a GitHub owner. A fine-grained token can only read one user's or org's repos, so
 * GITHUB_TOKEN_<OWNER> (uppercase, "-" → "_") wins over the default GITHUB_TOKEN.
 */
export function tokenFor(env: Env, owner: string): string | undefined {
  const secrets = env as unknown as Record<string, unknown>; // tokens are optional secrets, so they aren't in Env's type
  const pick = (name: string) => (typeof secrets[name] === "string" && secrets[name]) || undefined;
  return pick(`GITHUB_TOKEN_${owner.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`) ?? pick("GITHUB_TOKEN");
}

const headers = (token: string | undefined) => ({
  "User-Agent": "holdfast",
  Accept: "application/vnd.github+json",
  ...(token && { Authorization: `Bearer ${token}` }),
});

/** URLs of every repo owned by a GitHub user or org (private ones too when the token can see them). */
export async function listOwnerRepos(owner: string, token: string | undefined): Promise<string[]> {
  const res = await fetch(`https://api.github.com/users/${encodeURIComponent(owner)}`, { headers: headers(token) });
  if (res.status === 404) throw new Error(`GitHub user or organization "${owner}" not found`);
  if (!res.ok) throw new Error(`GitHub API error: HTTP ${res.status}`);
  const { type, login } = await res.json<{ type: string; login: string }>();

  let path = type === "Organization" ? `/orgs/${login}/repos?type=all` : `/users/${login}/repos?type=owner`;
  if (type === "User" && token) {
    const me = await fetch("https://api.github.com/user", { headers: headers(token) });
    // /users/:name/repos only lists public repos, even for yourself
    if (me.ok && (await me.json<{ login: string }>()).login.toLowerCase() === login.toLowerCase())
      path = "/user/repos?affiliation=owner";
  }

  const urls: string[] = [];
  for (let next: string | null = `https://api.github.com${path}&per_page=100`; next; ) {
    const page = await fetch(next, { headers: headers(token) });
    if (!page.ok) throw new Error(`GitHub API error: HTTP ${page.status}`);
    urls.push(...(await page.json<{ html_url: string }[]>()).map((r) => r.html_url));
    next = page.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
  }
  return urls;
}

/** Who a token belongs to and when it expires, from GitHub's own answer. */
export async function checkToken(token: string): Promise<{ ok: boolean; login?: string; expires?: string | null; detail?: string }> {
  const res = await fetch("https://api.github.com/user", { headers: headers(token) }).catch(() => null);
  if (!res) return { ok: false, detail: "GitHub is unreachable" };
  if (!res.ok) return { ok: false, detail: res.status === 401 ? "Rejected by GitHub: expired or revoked" : `GitHub error (HTTP ${res.status})` };
  return { ok: true, login: (await res.json<{ login: string }>()).login, expires: res.headers.get("github-authentication-token-expiration") };
}
