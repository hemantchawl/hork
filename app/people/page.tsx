import Link from "next/link";
import { toggleFollow } from "@/app/actions";
import { friendIds } from "@/lib/queries";
import { currentUser } from "@/lib/session";
import { readAll } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function People() {
  const viewer = await currentUser();
  const [users, logs] = await Promise.all([readAll("users"), readAll("logs")]);
  const following = await friendIds(viewer?.id);
  const counts = new Map<string, number>();
  for (const l of logs) counts.set(l.user_id, (counts.get(l.user_id) ?? 0) + 1);
  return (
    <main>
      <h1>People</h1>
      <ul className="list">
        {users.filter((u) => u.id !== viewer?.id).map((u) => (
          <li key={u.id} className="card row">
            <div><Link href={`/u/${u.handle}`}><strong>{u.display_name}</strong></Link> <span className="muted small">@{u.handle} · {counts.get(u.id) ?? 0} dishes</span></div>
            {viewer && (
              <form action={toggleFollow}>
                <input type="hidden" name="user_id" value={u.id} />
                <input type="hidden" name="back" value="/people" />
                <button className={`btn small${following.has(u.id) ? " ghost" : ""}`} type="submit">{following.has(u.id) ? "Following" : "Follow"}</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
