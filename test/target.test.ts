import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTarget } from "../src/github.ts";

test("parseTarget", () => {
  const cases: [string, ReturnType<typeof parseTarget>][] = [
    ["octocat", { owner: "octocat" }],
    [" octocat/ ", { owner: "octocat" }],
    ["octocat/Hello-World", { url: "https://github.com/octocat/Hello-World" }],
    ["octocat/hello.js.git", { url: "https://github.com/octocat/hello.js" }],
    ["https://github.com/octocat", { owner: "octocat" }],
    ["github.com/octocat/Hello-World", { url: "https://github.com/octocat/Hello-World" }],
    ["https://github.com/octocat/Hello-World/tree/main/docs", { url: "https://github.com/octocat/Hello-World" }],
    ["https://gitlab.com/group/sub/project.git", { url: "https://gitlab.com/group/sub/project" }],
    ["http://github.com/octocat/x", null],            // https only
    ["https://user:tok@github.com/octocat/x", null],  // no credentials in URLs
    ["ssh://git@github.com/octocat/x", null],
    ["https://github.com/", null],
    ["", null],
  ];
  for (const [input, want] of cases) assert.deepEqual(parseTarget(input), want, input);
});
