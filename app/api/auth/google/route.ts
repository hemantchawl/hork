import { NextResponse } from "next/server";
import { OAUTH_COOKIE, authorizationUrl, newOAuthState, redirectUri } from "@/lib/google";
import { googleEnabled } from "@/lib/session";

export async function GET(req: Request) {
  if (!googleEnabled()) return new Response("Google sign-in is not configured", { status: 404 });
  const nextParam = new URL(req.url).searchParams.get("next") ?? "/";
  const next = /^\/(?![/\\])/.test(nextParam) ? nextParam : "/";
  const s = newOAuthState(next);
  const res = NextResponse.redirect(authorizationUrl(s, redirectUri(req.url)));
  res.cookies.set(OAUTH_COOKIE, JSON.stringify(s), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/api/auth/google",
  });
  return res;
}
