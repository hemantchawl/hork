import Link from "next/link";
import { signIn, signOut } from "@/app/actions";
import FeedList from "@/components/FeedList";
import { feed } from "@/lib/queries";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Me({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const user = await currentUser();
  if (!user) {
    return (
      <main>
        <h1>Join the test</h1>
        <p className="muted">Pick a handle. No password — this is an invite-only prototype.</p>
        {error === "handle" && <p className="v-skip">Handles are 2–24 letters, numbers or underscores.</p>}
        <form action={signIn} className="card">
          <input type="hidden" name="next" value={next ?? "/"} />
          <label htmlFor="handle">Handle</label>
          <input id="handle" name="handle" required placeholder="beth" autoCapitalize="none" />
          <label htmlFor="display_name">Name</label>
          <input id="display_name" name="display_name" placeholder="Beth" />
          <p><button className="btn" type="submit">Continue</button></p>
        </form>
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
      <p className="muted small">@{user.handle} · {entries.length} dishes logged · <Link href={`/u/${user.handle}`}>Public list</Link> · <Link href="/people">People</Link></p>
      <h2>Your dishes</h2>
      <FeedList entries={entries} showUser={false} />
    </main>
  );
}
