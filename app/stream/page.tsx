import Link from "next/link";
import FeedList from "@/components/FeedList";
import { feed, friendIds } from "@/lib/queries";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Stream({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  const user = await currentUser();
  const friends = await friendIds(user?.id);
  const showAll = all === "1" || friends.size === 0;
  const entries = await feed({ userIds: showAll ? undefined : friends });
  return (
    <main>
      <h1>Hork Stream</h1>
      <div className="chips" style={{ margin: "8px 0 16px" }}>
        <Link className={`chip${!showAll ? " on" : ""}`} href="/stream">Friends</Link>
        <Link className={`chip${showAll ? " on" : ""}`} href="/stream?all=1">Everyone</Link>
      </div>
      {friends.size === 0 && <p className="muted small">You&apos;re not following anyone yet — <Link href="/people">find people</Link>. Showing everyone.</p>}
      <FeedList entries={entries} />
    </main>
  );
}
