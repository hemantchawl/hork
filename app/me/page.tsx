import Link from "next/link";
import { signIn, signOut, updateProfile } from "@/app/actions";
import FeedList from "@/components/FeedList";
import { feed } from "@/lib/queries";
import { currentUser, googleEnabled, handleLoginAllowed } from "@/lib/session";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  handle: "Handles are 2–24 letters, numbers or underscores.",
  taken: "That handle is taken.",
  google_cancelled: "Google sign-in was cancelled.",
  google_expired: "Sign-in took too long. Please try again.",
  google_state: "Sign-in couldn't be verified. Please try again.",
  google_failed: "Google sign-in failed. Please try again.",
};

export default async function Me({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const user = await currentUser();
  if (!user) {
    const google = googleEnabled();
    return (
      <main>
        <h1>Join the test</h1>
        {error && ERRORS[error] && <p className="v-skip">{ERRORS[error]}</p>}
        {google && (
          <p><a className="btn" href={`/api/auth/google?next=${encodeURIComponent(next ?? "/")}`}>Sign in with Google</a></p>
        )}
        {handleLoginAllowed() && (
          <>
            <p className="muted">{google ? "Or, for testing, pick a handle:" : "Pick a handle. No password — this is an invite-only prototype."}</p>
            <form action={signIn} className="card">
              <input type="hidden" name="next" value={next ?? "/"} />
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
