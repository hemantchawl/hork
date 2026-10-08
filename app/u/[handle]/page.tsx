import { notFound } from "next/navigation";
import { toggleFollow } from "@/app/actions";
import FeedList from "@/components/FeedList";
import { feed, friendIds } from "@/lib/queries";
import { currentUser } from "@/lib/session";
import { readAll } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Profile({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const person = (await readAll("users")).find((u) => u.handle === handle);
  if (!person) notFound();
  const viewer = await currentUser();
  const following = (await friendIds(viewer?.id)).has(person.id);
  const loved = (await feed({ userIds: new Set([person.id]), limit: 500 })).filter((e) => e.log.verdict === "love");
  return (
    <main>
      <div className="row">
        <h1>{person.display_name}</h1>
        {viewer && viewer.id !== person.id && (
          <form action={toggleFollow}>
            <input type="hidden" name="user_id" value={person.id} />
            <input type="hidden" name="back" value={`/u/${person.handle}`} />
            <button className={`btn small${following ? " ghost" : ""}`} type="submit">{following ? "Following" : "Follow"}</button>
          </form>
        )}
      </div>
      <p className="muted">Eat like @{person.handle}: every dish they loved.</p>
      <FeedList entries={loved} showUser={false} />
    </main>
  );
}
