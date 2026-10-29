import { test } from "node:test";
import assert from "node:assert/strict";
import { describeInterval, parseInterval, splitInterval } from "../src/schedule.ts";

test("parseInterval", () => {
  assert.equal(parseInterval("5", "minutes"), 5);
  assert.equal(parseInterval("90", "minutes"), 90);
  assert.equal(parseInterval("6", "hours"), 360);
  assert.equal(parseInterval("2", "days"), 2880);
  assert.equal(parseInterval("365", "days"), 525600);
  for (const [n, u] of [["4", "minutes"], ["0", "days"], ["-1", "hours"], ["1.5", "hours"], ["", "days"], ["366", "days"], ["1", "weeks"], ["1", "toString"], ["1", null]])
    assert.equal(parseInterval(n, u), null, `${n} ${u}`);
});

test("splitInterval + describeInterval", () => {
  assert.deepEqual(splitInterval(90), [90, "minutes"]);
  assert.deepEqual(splitInterval(120), [2, "hours"]);
  assert.deepEqual(splitInterval(1440), [1, "days"]);
  assert.equal(describeInterval(5), "Every 5 minutes");
  assert.equal(describeInterval(60), "Every hour");
  assert.equal(describeInterval(360), "Every 6 hours");
  assert.equal(describeInterval(1440), "Every day");
  assert.equal(describeInterval(10080), "Every 7 days");
});
