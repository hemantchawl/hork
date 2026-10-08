import Link from "next/link";
import { importMenu } from "@/app/actions";
import { redirect } from "next/navigation";
import { currentUser, isAdmin } from "@/lib/session";
import { readAll } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Admin({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const { r: selected } = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/me?next=/admin");
  if (!isAdmin(user)) return <main><h1>Admin</h1><p className="muted">Admins only.</p></main>;
  const [restaurants, items, logs, users] = await Promise.all([readAll("restaurants"), readAll("menu_items"), readAll("logs"), readAll("users")]);
  const byStatus = restaurants.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.menu_status]: (acc[r.menu_status] ?? 0) + 1 }), {});
  const missing = restaurants.filter((r) => r.menu_status !== "loaded" && r.website).slice(0, 60);
  const target = restaurants.find((r) => r.id === selected);

  return (
    <main>
      <h1>Admin</h1>
      <p className="muted small">
        {restaurants.length} restaurants · {Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(" · ")} ·{" "}
        {items.length} menu items · {users.length} people · {logs.length} logs
      </p>

      {target ? (
        <>
          <h2>Paste menu for {target.name}</h2>
          <form action={importMenu} className="card">
            <input type="hidden" name="restaurant_id" value={target.id} />
            <label htmlFor="source_url">Menu URL</label>
            <input id="source_url" name="source_url" defaultValue={target.menu_url ?? target.website ?? ""} />
            <label htmlFor="lines">One dish per line: Section | Dish | Price | dish_type | Description</label>
            <textarea id="lines" name="lines" rows={12} placeholder="Tacos | Taco de camarón | 3.50 | taco | Shrimp, salsa roja" />
            <p><button className="btn" type="submit">Import</button></p>
          </form>
        </>
      ) : (
        <>
          <h2>Restaurants without a menu (with a website)</h2>
          <ul className="list">
            {missing.map((r) => (
              <li key={r.id} className="card row">
                <div><strong>{r.name}</strong> <span className="badge status">{r.menu_status}</span>
                  <div className="small"><a href={r.website!} target="_blank" rel="noreferrer">{r.website}</a></div></div>
                <Link className="btn small ghost" href={`/admin?r=${encodeURIComponent(r.id)}`}>Add menu</Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
