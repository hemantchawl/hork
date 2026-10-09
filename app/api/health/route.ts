// Deployment self-check: which settings are present (never their values) and whether storage works.
// Open /api/health on the deployed site when something is misconfigured.
import { googleEnabled, handleLoginAllowed } from "@/lib/session";
import { readAll, storageKind, update } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = (k: string) => Boolean(process.env[k]);
  const checks: Record<string, unknown> = {
    storage: storageKind(),
    auth_secret_set: env("AUTH_SECRET") || env("SESSION_SECRET"),
    google_configured: googleEnabled(),
    handle_login_allowed: handleLoginAllowed(),
    blob_token_set: env("BLOB_READ_WRITE_TOKEN"),
    auth_url: process.env.AUTH_URL ?? null, // not secret; a wrong value breaks the Google redirect
  };
  try {
    checks.read_users = `ok (${(await readAll("users")).length} users)`;
  } catch (e) {
    checks.read_users = `FAILED: ${(e as Error).message}`;
  }
  try {
    // A no-op write proves the store accepts private, conditional writes.
    await update("follows", () => undefined);
    checks.write = "ok";
  } catch (e) {
    checks.write = `FAILED: ${(e as Error).message}`;
  }
  const ok = checks.auth_secret_set === true && !String(checks.read_users).startsWith("FAILED") && checks.write === "ok";
  return Response.json({ ok, ...checks }, { status: ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
}
