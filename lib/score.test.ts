import assert from "node:assert/strict";
import { test } from "node:test";
import { latestVerdicts, stats } from "./score";
import type { Log } from "./types";

test("one love does not outrank 8 loves out of 10", () => {
  const one = stats(["love"]);
  const eight = stats([...Array(8).fill("love"), "skip", "skip"]);
  assert.ok(eight.score > one.score);
});

test("badges need at least 3 ratings", () => {
  assert.equal(stats(["love", "love"]).badge, null);
  assert.equal(stats(["love", "love", "love"]).badge, "top");
  assert.equal(stats(["skip", "skip", "love"]).badge, "skip");
  assert.equal(stats(["love", "fine", "skip"]).badge, null);
});

test("latest verdict per user wins", () => {
  const mk = (user: string, v: Log["verdict"], t: string): Log => ({
    id: t, user_id: user, menu_item_id: "m1", restaurant_id: "r1", verdict: v, note: null, photo: null, created_at: t,
  });
  const m = latestVerdicts([mk("a", "skip", "2026-01-01"), mk("a", "love", "2026-02-01"), mk("b", "fine", "2026-01-05")]);
  assert.deepEqual(m.get("m1")?.sort(), ["fine", "love"]);
});
