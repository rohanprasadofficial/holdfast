// Minimal git smart-HTTP client (protocol v0): list refs, then download every ref as one
// packfile and wrap it as a standard `git bundle`. No git binary needed.
// Format refs: https://git-scm.com/docs/http-protocol, https://git-scm.com/docs/gitformat-bundle

export type Ref = { sha: string; name: string };

const dec = new TextDecoder();
const enc = new TextEncoder();
const pkt = (s: string) => (s.length + 4).toString(16).padStart(4, "0") + s;

function* pktLines(buf: Uint8Array) {
  for (let i = 0; i < buf.length; ) {
    const len = parseInt(dec.decode(buf.subarray(i, i + 4)), 16);
    if (len === 0) { i += 4; continue; } // flush-pkt
    if (!(len >= 4)) throw new Error("Malformed reply from git server");
    yield dec.decode(buf.subarray(i + 4, i + len));
    i += len;
  }
}

/** Follows redirects (renamed repos) only within the same host, so credentials never leave it. */
async function fetchSameHost(url: string, init: RequestInit) {
  for (let hops = 0; hops < 5; hops++) {
    const res = await fetch(url, { ...init, redirect: "manual" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("Location") : null;
    if (!location) return { res, url };
    const next = new URL(location, url);
    if (next.protocol !== "https:" || next.host !== new URL(url).host)
      throw new Error(`Git server redirected to ${next.host}; not following it with credentials.`);
    url = next.href;
  }
  throw new Error("Git server redirected too many times");
}

/** Branches, tags and HEAD of a repo, plus the final URL after redirects (renamed repos). */
export async function listRefs(repoUrl: string, headers: Record<string, string>) {
  const { res, url } = await fetchSameHost(`${repoUrl.endsWith(".git") ? repoUrl : `${repoUrl}.git`}/info/refs?service=git-upload-pack`, { headers });
  if (res.status === 401 || res.status === 403 || res.status === 404)
    throw new Error(headers.Authorization
      ? `Access refused (HTTP ${res.status}): the GitHub token may have expired or can't read this repository. Existing copies are kept.`
      : `Repository not found or private (HTTP ${res.status}). Private GitHub repos need a token, see DEPLOY.md. Existing copies are kept.`);
  if (!res.ok) throw new Error(`Git server error: HTTP ${res.status}`);
  const refs: Ref[] = [];
  for (const line of pktLines(new Uint8Array(await res.arrayBuffer()))) {
    if (line.startsWith("#")) continue; // "# service=git-upload-pack"
    const [sha, name] = line.split("\0")[0].trimEnd().split(" ");
    // pull/* refs and peeled "^{}" entries are skipped; empty repos advertise only "capabilities^{}"
    if (name === "HEAD" || name.startsWith("refs/heads/") || (name.startsWith("refs/tags/") && !name.endsWith("^{}")))
      refs.push({ sha, name });
  }
  return { refs, base: url.replace(/\/info\/refs\?.*$/, "") };
}

/** Raw packfile containing every object reachable from `refs`. */
export async function fetchPack(base: string, refs: Ref[], headers: Record<string, string>) {
  const wants = [...new Set(refs.map((r) => r.sha))];
  // No side-band capability requested, so the server replies "NAK" then the raw pack.
  const body = wants.map((sha, i) => pkt(`want ${sha}${i ? "" : " ofs-delta agent=git/holdfast"}\n`)).join("") + "0000" + pkt("done\n");
  const res = await fetch(`${base}/git-upload-pack`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/x-git-upload-pack-request", Accept: "application/x-git-upload-pack-result" },
    body,
    redirect: "manual", // never carry credentials through a redirect
  });
  if (!res.ok || !res.body) throw new Error(`Git server error during download: HTTP ${res.status}`);
  return res.body.pipeThrough(skipNak());
}

function skipNak() {
  let head: Uint8Array | null = new Uint8Array(0);
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      if (!head) return ctl.enqueue(chunk);
      const joined: Uint8Array = new Uint8Array(head.length + chunk.length);
      joined.set(head);
      joined.set(chunk, head.length);
      if (joined.length < 8) { head = joined; return; }
      if (dec.decode(joined.subarray(0, 8)) !== "0008NAK\n")
        throw new Error(`Git server refused the download: ${dec.decode(joined.subarray(0, 200)).slice(4).trim()}`);
      head = null;
      ctl.enqueue(joined.subarray(8));
    },
    flush() {
      if (head) throw new Error("Git server closed the connection before sending data");
    },
  });
}

export const bundleHeader = (refs: Ref[]) =>
  enc.encode("# v2 git bundle\n" + refs.map((r) => `${r.sha} ${r.name}\n`).join("") + "\n");
