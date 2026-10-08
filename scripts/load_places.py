"""Load real restaurants for one neighborhood from Overture Maps places into data/restaurants.json.

Overture places merge Foursquare Open Source Places, Meta and other open sources.
Reads only the Parquet row groups whose bounding box overlaps the area, so a run
downloads a few MB instead of ~11 GB.

Usage: python3 scripts/load_places.py [--area silver-lake] [--release 2026-09-23.1]
Needs: pip install pyarrow
Behind a TLS-inspecting proxy, set SSL_CERT_FILE to the proxy's CA bundle.
"""
import argparse, json, re, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import io
import pyarrow.compute as pc
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://overturemaps-us-west-2.s3.amazonaws.com/"
AREAS = json.loads((ROOT / "data" / "areas.json").read_text())

# Overture basic_category values we treat as places that serve dishes.
FOOD = re.compile(r"(restaurant|eatery|cafe|coffee_shop|bakery|^bar$|^pub$|brewery|food_truck|food_stand|"
                  r"food_court|dessert|ice_cream|donut|bagel|(^|_)deli($|_)|juice_bar|tea_room|bistro|diner)", re.I)


def list_files(release):
    url = f"{BASE}?list-type=2&prefix=release/{release}/theme=places/type=place/"
    xml = urllib.request.urlopen(url).read().decode()
    return [BASE + k for k in re.findall(r"<Key>([^<]*\.parquet)</Key>", xml)]


def _fetch(req, head=False, tries=6):
    """GET/HEAD with backoff: S3 through some proxies returns sporadic 404/5xx under load."""
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.headers if head else r.read()
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
            if attempt == tries - 1:
                raise
            time.sleep(1.5 * 2 ** attempt)


class HttpRangeFile(io.RawIOBase):
    """Minimal seekable file over HTTP range requests (urllib honours HTTPS_PROXY and SSL_CERT_FILE)."""

    def __init__(self, url):
        self.url, self.pos = url, 0
        req = urllib.request.Request(url, method="HEAD")
        self.size = int(_fetch(req, head=True)["Content-Length"])

    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        if n == 0 or self.pos >= self.size:
            return b""
        end = min(self.pos + n, self.size) - 1
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{end}"})
        data = _fetch(req)
        self.pos += len(data)
        return data

    def readinto(self, b):
        data = self.read(len(b)); b[:len(data)] = data; return len(data)


def overlapping_row_groups(md, box):
    names = [md.schema.column(i).path for i in range(md.num_columns)]
    idx = {n: names.index(f"bbox.{n}") for n in ("xmin", "xmax", "ymin", "ymax")}
    out = []
    for rg in range(md.num_row_groups):
        st = {n: md.row_group(rg).column(i).statistics for n, i in idx.items()}
        if any(s is None or not s.has_min_max for s in st.values()):
            out.append(rg)
            continue
        if st["xmax"].max < box["west"] or st["xmin"].min > box["east"]:
            continue
        if st["ymax"].max < box["south"] or st["ymin"].min > box["north"]:
            continue
        out.append(rg)
    return out


def scan(url, box, tries=4):
    for attempt in range(tries):
        try:
            return _scan(url, box)
        except Exception as e:  # S3 behind some proxies returns sporadic 404/5xx
            if attempt == tries - 1:
                raise
            print(f"retry {url.rsplit('/', 1)[-1][:10]}: {e.__class__.__name__}", file=sys.stderr)


def _scan(url, box):
    pf = pq.ParquetFile(io.BufferedReader(HttpRangeFile(url), buffer_size=2**20))
    rgs = overlapping_row_groups(pf.metadata, box)
    if not rgs:
        return []
    cols = ["id", "names", "basic_category", "confidence", "websites", "phones", "socials",
            "addresses", "operating_status", "sources", "bbox"]
    t = pf.read_row_groups(rgs, columns=cols)
    b = t.column("bbox")
    x = pc.struct_field(b, "xmin"); y = pc.struct_field(b, "ymin")
    mask = pc.and_(pc.and_(pc.greater_equal(x, box["west"]), pc.less_equal(x, box["east"])),
                   pc.and_(pc.greater_equal(y, box["south"]), pc.less_equal(y, box["north"])))
    return t.filter(mask).to_pylist()


def to_restaurant(r):
    addr = (r.get("addresses") or [{}])[0] or {}
    sources = [{"dataset": s.get("dataset"), "record_id": s.get("record_id")} for s in (r.get("sources") or [])]
    fsq = next((s["record_id"] for s in sources if (s["dataset"] or "").lower().startswith("foursquare")), None)
    return {
        "id": r["id"],
        "name": (r.get("names") or {}).get("primary"),
        "category": r.get("basic_category"),
        "lat": r["bbox"]["ymin"],
        "lng": r["bbox"]["xmin"],
        "address": addr.get("freeform"),
        "locality": addr.get("locality"),
        "postcode": addr.get("postcode"),
        "website": (r.get("websites") or [None])[0],
        "phone": (r.get("phones") or [None])[0],
        "instagram": next((s for s in (r.get("socials") or []) if "instagram" in s), None),
        "confidence": round(r.get("confidence") or 0, 3),
        "fsq_place_id": fsq,
        "google_place_id": None,
        "menu_url": None,
        "menu_status": "missing",
        "sources": sources,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--area", default="silver-lake")
    ap.add_argument("--release", default="2026-09-23.1")
    ap.add_argument("--min-confidence", type=float, default=0.6)
    args = ap.parse_args()
    box = AREAS[args.area]["bbox"]

    files = list_files(args.release)
    print(f"Scanning {len(files)} Overture files for {AREAS[args.area]['name']}...", file=sys.stderr)
    with ThreadPoolExecutor(2) as ex:
        rows = [r for part in ex.map(lambda u: scan(u, box), files) for r in part]

    keep = [to_restaurant(r) for r in rows
            if r.get("basic_category") and FOOD.search(r["basic_category"])
            and (r.get("operating_status") in (None, "open"))
            and (r.get("confidence") or 0) >= args.min_confidence]
    keep.sort(key=lambda r: (-r["confidence"], r["name"] or ""))
    for r in keep:
        r["area"] = args.area

    out = ROOT / "data" / "restaurants.json"
    existing = json.loads(out.read_text()) if out.exists() else []
    # Keep menu work already done for restaurants we've seen before.
    prior = {r["id"]: r for r in existing}
    merged = []
    for r in keep:
        p = prior.get(r["id"])
        if p:
            for k in ("google_place_id", "menu_url", "menu_status"):
                r[k] = p.get(k, r[k])
        merged.append(r)
    others = [r for r in existing if r.get("area") != args.area]
    out.write_text(json.dumps(others + merged, indent=2, ensure_ascii=False) + "\n")
    print(f"{len(rows)} places in area, {len(merged)} food places saved to {out.relative_to(ROOT)}", file=sys.stderr)


if __name__ == "__main__":
    main()
