// Sessions are a signed cookie: "<user id>.<expiry ms>.<HMAC-SHA256>". Users sign in with Google,
// or (for local development and tests) by picking a handle when HORK_ALLOW_HANDLE_LOGIN allows it.
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { readAll } from "./store";
import type { User } from "./types";

export const COOKIE = "hork_session";
const MAX_AGE_S = 60 * 60 * 24 * 180;
const DEV_SECRET = "hork-dev-only-secret-do-not-use-in-production";

function secret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production" && process.env.HORK_INSECURE_DEV_SESSIONS !== "1") {
    throw new Error("SESSION_SECRET must be set (32+ characters) in production");
  }
  return DEV_SECRET;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function sessionToken(userId: string, now = Date.now()) {
  const payload = `${userId}.${now + MAX_AGE_S * 1000}`;
  return `${payload}.${sign(payload)}`;
}

/** Returns the user id if the token is authentic and unexpired. */
export function verifySessionToken(token: string | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const payload = token.slice(0, i);
  const given = Buffer.from(token.slice(i + 1));
  const expected = Buffer.from(sign(payload));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const [userId, exp] = payload.split(".");
  return userId && Number(exp) > now ? userId : null;
}

export async function startSession(userId: string) {
  (await cookies()).set(COOKIE, sessionToken(userId), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: MAX_AGE_S, path: "/",
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const id = verifySessionToken((await cookies()).get(COOKIE)?.value);
  if (!id) return null;
  const users = await readAll("users");
  return users.find((u) => u.id === id) ?? null;
}

export function googleEnabled() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** Handle-only sign-in: on by default when Google isn't configured; otherwise only with HORK_ALLOW_HANDLE_LOGIN=1. */
export function handleLoginAllowed() {
  const flag = process.env.HORK_ALLOW_HANDLE_LOGIN;
  return flag ? flag === "1" : !googleEnabled();
}

/** Admins are listed in HORK_ADMINS (comma-separated handles or emails). If unset, any signed-in tester is an admin. */
export function isAdmin(user: User | null) {
  if (!user) return false;
  const list = (process.env.HORK_ADMINS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length === 0 || list.includes(user.handle) || (!!user.email && list.includes(user.email.toLowerCase()));
}
