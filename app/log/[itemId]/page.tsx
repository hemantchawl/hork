import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { logDish } from "@/app/actions";
import { readAll } from "@/lib/store";
import { currentUser } from "@/lib/session";

export default async function LogPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const user = await currentUser();
  if (!user) redirect(`/me?next=${encodeURIComponent(`/log/${itemId}`)}`);
  const item = (await readAll("menu_items")).find((i) => i.id === itemId);
  if (!item) notFound();
  const r = (await readAll("restaurants")).find((x) => x.id === item.restaurant_id);

  return (
    <main>
      <p className="muted small"><Link href={`/r/${item.restaurant_id}`}>← {r?.name}</Link></p>
      <h1>{item.name}</h1>
      <form action={logDish}>
        <input type="hidden" name="menu_item_id" value={item.id} />
        <div className="verdicts" role="radiogroup" aria-label="Your verdict">
          <input type="radio" id="v-love" name="verdict" value="love" required /><label className="love" htmlFor="v-love">♥ Love</label>
          <input type="radio" id="v-fine" name="verdict" value="fine" /><label className="fine" htmlFor="v-fine">~ Fine</label>
          <input type="radio" id="v-skip" name="verdict" value="skip" /><label className="skip" htmlFor="v-skip">✕ Skip</label>
        </div>
        <label htmlFor="photo">Photo (optional)</label>
        <input id="photo" name="photo" type="file" accept="image/*" capture="environment" />
        <label htmlFor="note">Note (optional)</label>
        <textarea id="note" name="note" rows={2} maxLength={500} placeholder="Ask for extra salsa verde" />
        <p><button className="btn" type="submit">Save</button></p>
      </form>
    </main>
  );
}
