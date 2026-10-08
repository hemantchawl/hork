import Link from "next/link";
import { notFound } from "next/navigation";
import { addDish } from "@/app/actions";
import { Badge, Counts, VERDICT_LABEL } from "@/components/Counts";
import { mapsUrl } from "@/lib/geo";
import { dishTypes, restaurantMenu } from "@/lib/queries";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

function price(cents: number | null) {
  return cents == null ? "" : `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
}

export default async function RestaurantPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ logged?: string }>;
}) {
  const { id } = await params;
  const { logged } = await searchParams;
  const viewer = await currentUser();
  const data = await restaurantMenu(decodeURIComponent(id), viewer);
  if (!data) notFound();
  const { restaurant: r, sections, itemCount } = data;
  const rated = sections.flatMap(([, rows]) => rows).filter((d) => d.stats.total > 0);
  const order = rated.filter((d) => d.stats.love > d.stats.skip && d.stats.badge !== "skip").sort((a, b) => b.stats.score - a.stats.score).slice(0, 3);
  const skips = rated.filter((d) => d.stats.badge === "skip");

  return (
    <main>
      <h1>{r.name}</h1>
      <p className="muted small">
        {[r.category?.replace(/_/g, " "), r.address].filter(Boolean).join(" · ")}
        {" · "}<a href={mapsUrl(r)} target="_blank" rel="noreferrer">Maps</a>
        {r.website && <>{" · "}<a href={r.website} target="_blank" rel="noreferrer">Website</a></>}
      </p>
      {logged && <div className="notice">Logged. Thanks — your friends will see it in their stream.</div>}

      {(order.length > 0 || skips.length > 0) && (
        <div className="card">
          <strong>What&apos;s good here</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {order.map((d) => <li key={d.id}><a href={`#${d.id}`}>{d.name}</a> <Counts s={d.stats} /></li>)}
          </ul>
          {skips.length > 0 && (
            <p className="small" style={{ margin: "8px 0 0" }}>
              <span className="v-skip">Skip:</span> {skips.map((d) => d.name).join(", ")}
            </p>
          )}
        </div>
      )}

      {itemCount === 0 && (
        <div className="card">
          <p><strong>We don&apos;t have this menu yet.</strong></p>
          <p className="muted small">Add what you&apos;re eating below, or snap the menu and send it to the Hork team.</p>
        </div>
      )}

      {sections.map(([name, rows]) => (
        <section key={name}>
          <h2>{name}</h2>
          <ul className="list">
            {rows.map((d) => (
              <li key={d.id} id={d.id} className="card">
                <div className="row">
                  <div>
                    <div className="dish-name">{d.name}<Badge s={d.stats} /></div>
                    {d.description && <div className="muted small">{d.description}</div>}
                    {d.friends.length > 0 && (
                      <div className="friends">
                        {d.friends.map((f, i) => (
                          <span key={f.user.id}>{i > 0 && ", "}<Link href={`/u/${f.user.handle}`}>{f.user.display_name}</Link>{" "}
                            <span className={`v-${f.verdict}`}>{VERDICT_LABEL[f.verdict]}</span></span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div>{price(d.price_cents)}</div>
                    <Counts s={d.stats} />
                  </div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <Link className="btn small" href={`/log/${d.id}`}>I ate this</Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <h2>Not on the menu?</h2>
      <details className="card">
        <summary>Add a dish (special or off-menu)</summary>
        <form action={addDish}>
          <input type="hidden" name="restaurant_id" value={r.id} />
          <label htmlFor="name">Dish name</label>
          <input id="name" name="name" required maxLength={120} />
          <label htmlFor="description">Description (optional)</label>
          <input id="description" name="description" maxLength={300} />
          <label htmlFor="dish_type">Type (optional)</label>
          <select id="dish_type" name="dish_type" defaultValue="">
            <option value="">—</option>
            {dishTypes().map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <p><button className="btn" type="submit">Add and log it</button></p>
        </form>
      </details>
      {r.menu_url && <p className="muted small">Menu source: <a href={r.menu_url} target="_blank" rel="noreferrer">{new URL(r.menu_url).hostname}</a></p>}
    </main>
  );
}
