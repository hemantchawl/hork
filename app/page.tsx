import NearbyList from "@/components/NearbyList";
import { defaultArea } from "@/lib/areas";

export default function Here() {
  const area = defaultArea();
  return (
    <main>
      <h1>Where are you eating?</h1>
      <p className="muted">Good for you. You found this place. Now, what to order.</p>
      <NearbyList fallback={{ ...area.center, name: area.name }} />
    </main>
  );
}
