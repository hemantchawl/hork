export type Verdict = "love" | "fine" | "skip";

export interface Restaurant {
  id: string; // Overture place id
  name: string;
  category: string | null;
  lat: number;
  lng: number;
  address: string | null;
  locality: string | null;
  postcode: string | null;
  website: string | null;
  phone: string | null;
  instagram: string | null;
  confidence: number;
  fsq_place_id: string | null;
  google_place_id: string | null;
  menu_url: string | null;
  menu_status: "missing" | "loaded" | "failed" | "needs_photo";
  area: string;
}

export interface MenuItem {
  id: string;
  restaurant_id: string;
  section: string | null;
  name: string;
  description: string | null;
  price_cents: number | null;
  dish_type: string | null;
  source: "web" | "pdf" | "photo" | "user";
  source_url: string | null;
  active: boolean;
  added_by?: string;
  created_at: string;
}

export interface User {
  id: string;
  handle: string;
  display_name: string;
  created_at: string;
  google_sub?: string; // Google account id, when signed in with Google
  email?: string;
  avatar_url?: string;
}

export interface Follow {
  follower_id: string;
  followee_id: string;
}

export interface Log {
  id: string;
  user_id: string;
  menu_item_id: string;
  restaurant_id: string;
  verdict: Verdict;
  note: string | null;
  photo: string | null; // file name under data/uploads
  created_at: string;
}
