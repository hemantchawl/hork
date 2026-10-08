import Link from "next/link";
import { VERDICT_LABEL } from "./Counts";
import type { FeedEntry } from "@/lib/queries";

export default function FeedList({ entries, showUser = true }: { entries: FeedEntry[]; showUser?: boolean }) {
  if (!entries.length) return <p className="muted">Nothing here yet.</p>;
  return (
    <ul className="list">
      {entries.map(({ log, user, item, restaurant }) => (
        <li key={log.id} className="card">
          <div className="row">
            <div>
              {showUser && <div className="small"><Link href={`/u/${user.handle}`}><strong>{user.display_name}</strong></Link></div>}
              <div className="dish-name">{item.name}</div>
              <div className="muted small"><Link href={`/r/${restaurant.id}`}>{restaurant.name}</Link> · {new Date(log.created_at).toLocaleDateString()}</div>
              {log.note && <div className="small">“{log.note}”</div>}
            </div>
            <span className={`v-${log.verdict}`}>{VERDICT_LABEL[log.verdict]}</span>
          </div>
          {log.photo && <img className="photo" src={`/api/uploads/${log.photo}`} alt={item.name} loading="lazy" />}
        </li>
      ))}
    </ul>
  );
}
