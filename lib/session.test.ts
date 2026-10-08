import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionToken, verifySessionToken } from "./session";

test("valid session token round-trips", () => {
  assert.equal(verifySessionToken(sessionToken("u_abc")), "u_abc");
});

test("tampered or forged tokens are rejected", () => {
  const t = sessionToken("u_abc");
  assert.equal(verifySessionToken(t.replace("u_abc", "u_xyz")), null);
  assert.equal(verifySessionToken("u_abc"), null);
  assert.equal(verifySessionToken(`u_abc.${Date.now() + 1e9}.forged`), null);
  assert.equal(verifySessionToken(undefined), null);
});

test("expired tokens are rejected", () => {
  const t = sessionToken("u_abc", Date.now() - 1000 * 60 * 60 * 24 * 365);
  assert.equal(verifySessionToken(t), null);
});
