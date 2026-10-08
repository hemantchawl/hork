// Google sign-in with the OAuth 2.0 authorization-code flow + PKCE, verifying the ID token Google returns.
// Docs: https://developers.google.com/identity/openid-connect/openid-connect
import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export const OAUTH_COOKIE = "hork_oauth";

export interface OAuthState { state: string; verifier: string; nonce: string; next: string }

const b64url = (b: Buffer) => b.toString("base64url");

export function newOAuthState(next: string): OAuthState {
  return { state: b64url(randomBytes(24)), verifier: b64url(randomBytes(48)), nonce: b64url(randomBytes(24)), next };
}

export function redirectUri(requestUrl: string) {
  const base = process.env.APP_URL?.replace(/\/$/, "") ?? new URL(requestUrl).origin;
  return `${base}/api/auth/google/callback`;
}

export function authorizationUrl(s: OAuthState, redirect: string) {
  const challenge = b64url(createHash("sha256").update(s.verifier).digest());
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirect,
    response_type: "code",
    scope: "openid email profile",
    state: s.state,
    nonce: s.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${AUTH_URL}?${params}`;
}

export interface GoogleProfile { sub: string; email: string; name: string | null; picture: string | null }

export async function exchangeCode(code: string, s: OAuthState, redirect: string): Promise<GoogleProfile> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, code_verifier: s.verifier, redirect_uri: redirect, grant_type: "authorization_code",
      client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`);
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new Error("Google returned no ID token");

  const { payload } = await jwtVerify(id_token, JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: process.env.GOOGLE_CLIENT_ID!,
  });
  if (payload.nonce !== s.nonce) throw new Error("Sign-in nonce mismatch");
  if (!payload.sub || typeof payload.email !== "string" || payload.email_verified !== true) {
    throw new Error("Google account has no verified email");
  }
  return {
    sub: payload.sub,
    email: payload.email,
    name: typeof payload.name === "string" ? payload.name : null,
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
}
