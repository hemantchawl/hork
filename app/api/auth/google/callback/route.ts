import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { OAUTH_COOKIE, exchangeCode, redirectUri, type OAuthState } from "@/lib/google";
import { googleEnabled, startSession } from "@/lib/session";
import { newId, update } from "@/lib/store";
import type { User } from "@/lib/types";

function fail(req: Request, reason: string) {
  return NextResponse.redirect(new URL(`/me?error=${encodeURIComponent(reason)}`, req.url));
}

/** A unique handle from the email's local part, e.g. "beth.lee@gmail.com" -> "bethlee" or "bethlee2". */
function pickHandle(email: string, taken: Set<string>) {
  const base = (email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "") || "eater").slice(0, 20).padEnd(2, "0");
  let h = base;
  for (let n = 2; taken.has(h); n++) h = `${base}${n}`;
  return h;
}

export async function GET(req: Request) {
  if (!googleEnabled()) return new Response("Google sign-in is not configured", { status: 404 });
  const url = new URL(req.url);
  const jar = await cookies();
  const raw = jar.get(OAUTH_COOKIE)?.value;
  jar.delete({ name: OAUTH_COOKIE, path: "/api/auth/google" });
  if (url.searchParams.get("error")) return fail(req, "google_cancelled");

  let s: OAuthState;
  try { s = JSON.parse(raw ?? ""); } catch { return fail(req, "google_expired"); }
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.get("state") !== s.state) return fail(req, "google_state");

  let profile;
  try {
    profile = await exchangeCode(code, s, redirectUri(req.url));
  } catch (e) {
    console.error("Google sign-in failed:", (e as Error).message);
    return fail(req, "google_failed");
  }

  const user = await update("users", (users): User => {
    const existing = users.find((u) => u.google_sub === profile.sub)
      ?? users.find((u) => !u.google_sub && u.email?.toLowerCase() === profile.email.toLowerCase());
    if (existing) {
      Object.assign(existing, { google_sub: profile.sub, email: profile.email, avatar_url: profile.picture ?? existing.avatar_url });
      return existing;
    }
    const u: User = {
      id: newId("u"), handle: pickHandle(profile.email, new Set(users.map((x) => x.handle))),
      display_name: profile.name ?? profile.email.split("@")[0], created_at: new Date().toISOString(),
      google_sub: profile.sub, email: profile.email, avatar_url: profile.picture ?? undefined,
    };
    users.push(u);
    return u;
  });
  await startSession(user.id);
  return NextResponse.redirect(new URL(s.next || "/", req.url));
}
