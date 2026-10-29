// Builds real bundles from small public repos and lets git itself validate them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleHeader, fetchPack, listRefs } from "../src/git.ts";

for (const repo of ["https://github.com/octocat/Hello-World", "https://github.com/sindresorhus/slugify"]) {
  test(`${repo} → valid git bundle`, async () => {
    const { refs, base } = await listRefs(repo, { "User-Agent": "git/holdfast" });
    assert.ok(refs.some((r) => r.name === "HEAD"));
    const chunks: Uint8Array[] = [bundleHeader(refs)];
    for await (const c of await fetchPack(base, refs, { "User-Agent": "git/holdfast" })) chunks.push(c);

    const dir = mkdtempSync(join(tmpdir(), "holdfast-"));
    writeFileSync(join(dir, "r.bundle"), Buffer.concat(chunks));
    execFileSync("git", ["clone", "-q", "--mirror", join(dir, "r.bundle"), join(dir, "clone")]); // throws if invalid
    execFileSync("git", ["-C", join(dir, "clone"), "fsck", "--full", "--no-dangling"]);
    const cloned = execFileSync("git", ["-C", join(dir, "clone"), "show-ref"], { encoding: "utf8" }).trim().split("\n");
    assert.equal(cloned.length, refs.filter((r) => r.name !== "HEAD").length);
  });
}

test("missing repo → clear error, nothing thrown about parsing", async () => {
  await assert.rejects(listRefs("https://github.com/octocat/does-not-exist-xyz", {}), /not found or private/);
});
