// Credentials must only ever reach https://github.com, for the right owner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gitHeaders } from "../src/backup.ts";
import { listRefs } from "../src/git.ts";
import { tokenFor } from "../src/github.ts";

const env = { GITHUB_TOKEN: "default", GITHUB_TOKEN_ACME_INC: "acme" } as unknown as Env;
const auth = (url: string) => gitHeaders(url, env).Authorization;
const basic = (t: string) => `Basic ${btoa(`x-access-token:${t}`)}`;

test("token picked per owner, default otherwise", () => {
  assert.equal(tokenFor(env, "acme-inc"), "acme");
  assert.equal(tokenFor(env, "someone"), "default");
  assert.equal(tokenFor({} as Env, "someone"), undefined);
  assert.equal(auth("https://github.com/acme-inc/api"), basic("acme"));
  assert.equal(auth("https://github.com/me/dotfiles"), basic("default"));
});

test("no token for other hosts or plain http", () => {
  assert.equal(auth("https://gitlab.com/acme-inc/api"), undefined);
  assert.equal(auth("https://github.com.evil.example/acme-inc/api"), undefined);
  assert.equal(auth("http://github.com/acme-inc/api"), undefined);
});

test("redirect to another host is refused before credentials are re-sent", async () => {
  const real = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return new Response(null, { status: 301, headers: { Location: "https://evil.example/steal" } });
  }) as typeof fetch;
  try {
    await assert.rejects(listRefs("https://github.com/acme-inc/api", { Authorization: basic("acme") }), /redirected to evil\.example/);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = real;
  }
});
