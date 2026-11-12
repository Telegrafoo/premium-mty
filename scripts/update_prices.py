"""Descarga los precios oficiales de gasolina Premium y genera los datos de la app.

Fuente: publicación de precios que reportan los permisionarios al regulador de energía
(antes CRE, hoy CNE). Son dos archivos XML: `places` (estación, permiso y coordenadas)
y `prices` (precio vigente por estación, sin fecha).

Como los precios no traen fecha, este script guarda una foto diaria y calcula desde
cuándo vemos cada precio. También descarta precios imposibles y marca los dudosos.

Uso:  python3 scripts/update_prices.py            (descarga y actualiza data/)
      python3 scripts/update_prices.py --from DIR  (usa prices.xml y places.xml locales)
Solo usa la biblioteca estándar.
"""
import argparse
import datetime as dt
import json
import math
import os
import statistics
import sys
import urllib.request
import xml.etree.ElementTree as ET

SOURCE = "https://publicacionexterna.azurewebsites.net/publicaciones/"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
TZ = dt.timezone(dt.timedelta(hours=-6))  # Monterrey, sin horario de verano

# Área metropolitana de Monterrey (caja amplia) y centros municipales para la zona aproximada
BBOX = {"lon": (-100.62, -99.95), "lat": (25.50, 26.02)}
ZONES = [
    ("Monterrey", 25.6866, -100.3161),
    ("Monterrey sur", 25.6080, -100.2700),
    ("San Pedro", 25.6573, -100.4022),
    ("San Nicolás", 25.7441, -100.3022),
    ("Guadalupe", 25.6775, -100.2597),
    ("Apodaca", 25.7817, -100.1886),
    ("Escobedo", 25.7972, -100.3226),
    ("Santa Catarina", 25.6733, -100.4581),
    ("García", 25.8076, -100.5928),
    ("Juárez", 25.6467, -100.0950),
    ("Pesquería", 25.7850, -100.0510),
    ("Cadereyta", 25.5890, -99.9970),
    ("Salinas Victoria", 25.9610, -100.2910),
    ("El Carmen", 25.9330, -100.3620),
]

HARD_MIN, HARD_MAX = 20.0, 40.0   # fuera de esto es un error de captura
VERY_LOW_GAP = 4.0                # más de $4 bajo la mediana: siempre "por verificar"
LOW_GAP = 2.5                     # entre $2.50 y $4 bajo la mediana: se acepta si dura STABLE_DAYS
STABLE_DAYS = 3
HISTORY_DAYS = 400


def fetch(name, local_dir):
    if local_dir:
        with open(os.path.join(local_dir, name + ".xml"), "rb") as f:
            return f.read()
    req = urllib.request.Request(SOURCE + name, headers={"User-Agent": "gasolina-mty/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def parse(places_xml, prices_xml):
    places = {}
    for p in ET.fromstring(places_xml).findall("place"):
        loc = p.find("location")
        try:
            lon, lat = float(loc.findtext("x")), float(loc.findtext("y"))
        except (TypeError, ValueError, AttributeError):
            continue
        places[p.get("place_id")] = {
            "name": (p.findtext("name") or "").strip(),
            "permit": (p.findtext("cre_id") or "").strip(),
            "lat": lat,
            "lon": lon,
        }
    prices = {}
    conflicts = set()
    for p in ET.fromstring(prices_xml).findall("place"):
        pid = p.get("place_id")
        for g in p.findall("gas_price"):
            try:
                v = float(g.text)
            except (TypeError, ValueError):
                continue
            t = g.get("type")
            slot = prices.setdefault(pid, {})
            if t in slot and slot[t] != v:
                conflicts.add(pid)
            slot[t] = v
    return places, prices, conflicts


def zone_of(lat, lon):
    best, dist = None, 1e9
    for name, zlat, zlon in ZONES:
        d = (lat - zlat) ** 2 + ((lon - zlon) * math.cos(math.radians(lat))) ** 2
        if d < dist:
            best, dist = name, d
    return best


def load(name, default):
    try:
        with open(os.path.join(DATA, name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def pct(values, q):
    s = sorted(values)
    if not s:
        return None
    k = (len(s) - 1) * q
    lo, hi = math.floor(k), math.ceil(k)
    return round(s[lo] + (s[hi] - s[lo]) * (k - lo), 2)


def build(places, prices, conflicts, today):
    prev = {s["id"]: s for s in load("stations.json", {}).get("stations", [])}
    rows, dropped = [], 0
    for pid, pl in places.items():
        if not (BBOX["lon"][0] <= pl["lon"] <= BBOX["lon"][1] and BBOX["lat"][0] <= pl["lat"] <= BBOX["lat"][1]):
            continue
        pr = prices.get(pid, {})
        premium = pr.get("premium")
        if premium is None:
            continue
        if not (HARD_MIN <= premium <= HARD_MAX):
            dropped += 1
            continue
        rows.append({"pid": pid, "pl": pl, "premium": premium, "regular": pr.get("regular")})

    median = statistics.median(r["premium"] for r in rows) if rows else 0
    out = []
    for r in rows:
        pid, pl, price = r["pid"], r["pl"], r["premium"]
        old = prev.get(pid)
        if old and old.get("price") == price:
            since, last, changed = old.get("since", today), old.get("last"), old.get("changed")
        elif old:
            since, last, changed = today, old.get("price"), today
        else:
            since, last, changed = today, None, None
        stable = (dt.date.fromisoformat(today) - dt.date.fromisoformat(since)).days + 1
        flags = []
        if price <= median - VERY_LOW_GAP:
            flags.append("bajo")
        elif price < median - LOW_GAP and stable < STABLE_DAYS:
            flags.append("bajo-nuevo")
        if r["regular"] is not None and price <= r["regular"]:
            flags.append("menor-que-regular")
        if pid in conflicts:
            flags.append("duplicado")
        out.append({
            "id": pid,
            "name": pl["name"],
            "permit": pl["permit"],
            "lat": round(pl["lat"], 5),
            "lon": round(pl["lon"], 5),
            "zone": zone_of(pl["lat"], pl["lon"]),
            "price": price,
            "since": since,
            "last": last,
            "changed": changed,
            "flags": flags,
        })
    out.sort(key=lambda s: (s["price"], s["name"]))
    return out, dropped, median


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="local", help="carpeta con prices.xml y places.xml")
    ap.add_argument("--date", help="fecha a registrar (AAAA-MM-DD), útil para pruebas")
    args = ap.parse_args()

    now = dt.datetime.now(TZ)
    today = args.date or now.strftime("%Y-%m-%d")
    places, prices, conflicts = parse(fetch("places", args.local), fetch("prices", args.local))
    stations, dropped, median = build(places, prices, conflicts, today)

    # Si la fuente viene vacía o rota, no sobrescribir los datos buenos de ayer
    if len(stations) < 200:
        print("Muy pocas estaciones (%d); se conservan los datos anteriores." % len(stations), file=sys.stderr)
        sys.exit(1)

    clean = [s["price"] for s in stations if not s["flags"]]
    stats = {
        "count": len(stations),
        "verified": len(clean),
        "flagged": len(stations) - len(clean),
        "dropped": dropped,
        "min": min(clean),
        "p25": pct(clean, 0.25),
        "median": pct(clean, 0.5),
        "max": max(clean),
        "atMax": sum(1 for p in clean if p == max(clean)),
    }

    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, "stations.json"), "w", encoding="utf-8") as f:
        json.dump({
            "updated": now.isoformat(timespec="minutes"),
            "date": today,
            "source": SOURCE,
            "stats": stats,
            "stations": stations,
        }, f, ensure_ascii=False, separators=(",", ":"))

    hist = load("history.json", {"days": [], "changes": {}})
    hist["days"] = [d for d in hist["days"] if d["date"] != today]
    hist["days"].append({"date": today, "min": stats["min"], "p25": stats["p25"], "median": stats["median"], "max": stats["max"], "count": stats["count"]})
    hist["days"] = sorted(hist["days"], key=lambda d: d["date"])[-HISTORY_DAYS:]
    for s in stations:
        log = hist["changes"].setdefault(s["id"], [])
        if not log or log[-1][1] != s["price"]:
            log.append([today, s["price"]])
        hist["changes"][s["id"]] = log[-60:]
    with open(os.path.join(DATA, "history.json"), "w", encoding="utf-8") as f:
        json.dump(hist, f, ensure_ascii=False, separators=(",", ":"))

    print("%s: %d estaciones con Premium (%d por verificar, %d descartadas). Mínimo %.2f, mediana %.2f." % (
        today, stats["count"], stats["flagged"], dropped, stats["min"], stats["median"]))


if __name__ == "__main__":
    main()
