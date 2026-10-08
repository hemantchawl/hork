import assert from "node:assert/strict";
import { test } from "node:test";
import { googleEnabled, handleLoginAllowed } from "./session";

const GOOGLE_KEYS = ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "HORK_ALLOW_HANDLE_LOGIN"] as const;

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev = Object.fromEntries(GOOGLE_KEYS.map((k) => [k, process.env[k]]));
  try {
    for (const k of GOOGLE_KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fn();
  } finally {
    for (const k of GOOGLE_KEYS) {
      const v = prev[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("googleEnabled is true when Auth.js or Google client credentials are set", () => {
  withEnv({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" }, () => {
    assert.equal(googleEnabled(), true);
  });
  withEnv({ AUTH_GOOGLE_ID: "id", AUTH_GOOGLE_SECRET: "secret" }, () => {
    assert.equal(googleEnabled(), true);
  });
  withEnv({}, () => {
    assert.equal(googleEnabled(), false);
  });
});

test("handle login defaults on when Google is off", () => {
  withEnv({}, () => {
    assert.equal(handleLoginAllowed(), true);
  });
  withEnv({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" }, () => {
    assert.equal(handleLoginAllowed(), false);
  });
  withEnv({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", HORK_ALLOW_HANDLE_LOGIN: "1" }, () => {
    assert.equal(handleLoginAllowed(), true);
  });
});
