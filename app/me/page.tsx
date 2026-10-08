import Link from "next/link";
import { signIn, signInWithGoogle, signOut, updateProfile } from "@/app/actions";
import FeedList from "@/components/FeedList";
import { feed } from "@/lib/queries";
import { currentUser, googleEnabled, handleLoginAllowed } from "@/lib/session";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  handle: "Handles are 2–24 letters, numbers or underscores.",
  taken: "That handle is taken.",
  OAuthAccountNotLinked: "This email is already on an account. Sign in with Google again to link it.",
  OAuthSignin: "Google sign-in failed to start. Try again.",
  OAuthCallback: "Google sign-in was interrupted. Try again.",
  AccessDenied: "Access was denied. Try a different Google account.",
  Configuration: "Sign-in is not configured. Check Google OAuth environment variables.",
  CredentialsSignin: "Handle sign-in failed. Please try again.",
  Default: "Sign-in failed. Please try again.",
};

export default async function Me({ searchParams }: { searchParams: Promise<{ next?: string; callbackUrl?: string; error?: string }> }) {
  const { next, callbackUrl, error } = await searchParams;
  const redirectTo = next ?? callbackUrl ?? "/";
  const user = await currentUser();
  if (!user) {
    const google = googleEnabled();
    const googleAction = signInWithGoogle.bind(null, redirectTo);
    return (
      <main>
        <h1>Join the test</h1>
        {error && <p className="v-skip">{ERRORS[error] ?? ERRORS.Default}</p>}
        {google && (
          <form action={googleAction}>
            <p><button className="btn" type="submit">Sign in with Google</button></p>
          </form>
        )}
        {handleLoginAllowed() && (
          <>
            <p className="muted">{google ? "Or, for testing, pick a handle:" : "Pick a handle. No password — this is an invite-only prototype."}</p>
            <form action={signIn} className="card">
              <input type="hidden" name="next" value={redirectTo} />
              <label htmlFor="handle">Handle</label>
              <input id="handle" name="handle" required placeholder="beth" autoCapitalize="none" />
              <label htmlFor="display_name">Name</label>
              <input id="display_name" name="display_name" placeholder="Beth" />
              <p><button className="btn" type="submit">Continue</button></p>
            </form>
          </>
        )}
        {!google && !handleLoginAllowed() && <p className="muted">Sign-in isn&apos;t configured.</p>}
      </main>
    );
  }
  const entries = await feed({ userIds: new Set([user.id]), limit: 500 });
  return (
    <main>
      <div className="row">
        <h1>{user.display_name}</h1>
        <form action={signOut}><button className="btn ghost small" type="submit">Sign out</button></form>
      </div>
      <p className="muted small">{user.email && <>{user.email} · </>}@{user.handle} · {entries.length} dishes logged · <Link href={`/u/${user.handle}`}>Public list</Link> · <Link href="/people">People</Link></p>
      {error && ERRORS[error] && <p className="v-skip">{ERRORS[error]}</p>}
      <details className="card">
        <summary>Edit name and handle</summary>
        <form action={updateProfile}>
          <label htmlFor="p-handle">Handle</label>
          <input id="p-handle" name="handle" defaultValue={user.handle} required autoCapitalize="none" />
          <label htmlFor="p-name">Name</label>
          <input id="p-name" name="display_name" defaultValue={user.display_name} />
          <p><button className="btn small" type="submit">Save</button></p>
        </form>
      </details>
      <h2>Your dishes</h2>
      <FeedList entries={entries} showUser={false} />
    </main>
  );
}
