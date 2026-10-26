#!/usr/bin/env python3
"""Hämtar tariffdata från Göteborg Energi Nät (UAT och Prod) och sparar den som JSON.

Används av GitHub Actions-workflowet (publish.yml), eftersom API:t saknar CORS-headers och
därför inte kan anropas direkt från en webbsida. Resultatet blir statiska filer som sidan läser:

    <out>/manifest.json                 när/hur varje miljö hämtades
    <out>/<env>/info.json               svar från /info
    <out>/<env>/tariffs.json            svar från /tariffs
    <out>/<env>/prices/<nyckel>.json    svar från /prices för varje timprissatt (dynamic) komponent

Körning:  python3 scripts/fetch_data.py --out data
Avslutskod 0 om minst en miljö hämtades, annars 1.
"""
import argparse
import json
import re
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen

ENVS = {
    "uat": "https://api.uat.goteborgenergi.cloud/gridtariff/v0",
    "prod": "https://api.goteborgenergi.cloud/gridtariff/v0",
}
USER_AGENT = "grid-tariff-client (+https://github.com/mapaq/grid-tariff-client)"


def get_json(url, retries=3, timeout=30):
    """GET en URL och returnera tolkad JSON. Försöker om några gånger vid fel."""
    last = None
    for attempt in range(retries):
        try:
            req = Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT})
            with urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except HTTPError as e:
            last = RuntimeError(f"HTTP {e.code} från {url}")
        except Exception as e:  # nätverksfel, timeout, ogiltig JSON
            last = RuntimeError(f"{type(e).__name__}: {e} ({url})")
        if attempt < retries - 1:
            time.sleep(2 * (attempt + 1))
    raise last


def price_key(comp):
    """Filnamn (utan .json) för en prissatt komponent. Måste matcha priceKey() i index.html."""
    q = parse_qs(urlsplit(comp.get("url") or "").query)
    raw = (q.get("product") or q.get("componentId") or ["c-" + str(comp.get("id", "unknown"))])[0]
    return re.sub(r"[^A-Za-z0-9_-]", "_", raw)


def price_query(comp):
    """Query-delen till /prices för en komponent (bara query tas från API:ts url – aldrig värd/sökväg)."""
    url = comp.get("url")
    if url:
        return urlsplit(url).query
    return urlencode({"componentId": comp["id"]})


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def fetch_env(env, base, out_dir):
    """Hämta allt för en miljö. Skriver bara filer om /info och /tariffs lyckades."""
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    try:
        info = get_json(f"{base}/info")
        tariffs = get_json(f"{base}/tariffs")
    except Exception as e:
        return {"ok": False, "fetchedAt": fetched_at, "error": str(e)}

    prices, errors = {}, []
    for t in tariffs.get("tariffs", []):
        for comp in (t.get("powerPrice") or {}).get("components") or []:
            if comp.get("type") != "dynamic":
                continue
            key = price_key(comp)
            if key in prices:
                continue
            try:
                prices[key] = get_json(f"{base}/prices?{price_query(comp)}")
            except Exception as e:
                prices[key] = {"error": str(e)}
                errors.append(f"{key}: {e}")

    env_dir = out_dir / env
    shutil.rmtree(env_dir, ignore_errors=True)
    write_json(env_dir / "info.json", info)
    write_json(env_dir / "tariffs.json", tariffs)
    for key, data in prices.items():
        write_json(env_dir / "prices" / f"{key}.json", data)
    status = {
        "ok": True,
        "fetchedAt": fetched_at,
        "tariffs": len(tariffs.get("tariffs", [])),
        "priceFiles": len(prices),
        "priceErrors": len(errors),
    }
    if errors:
        status["priceErrorDetails"] = errors
    return status


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default="data", help="målmapp (standard: data)")
    ap.add_argument("--envs", default="uat,prod", help="kommaseparerad lista (standard: uat,prod)")
    args = ap.parse_args(argv)

    out_dir = Path(args.out)
    envs = {}
    for env in [e.strip() for e in args.envs.split(",") if e.strip()]:
        if env not in ENVS:
            sys.exit(f"Okänd miljö: {env} (välj bland {', '.join(ENVS)})")
        status = fetch_env(env, ENVS[env], out_dir)
        envs[env] = status
        if status["ok"]:
            print(f"[{env}] OK: {status['tariffs']} tariffer, {status['priceFiles']} prisfiler, {status['priceErrors']} prisfel")
            for line in status.get("priceErrorDetails", []):
                print(f"[{env}] VARNING {line}", file=sys.stderr)
        else:
            print(f"[{env}] MISSLYCKADES: {status['error']}", file=sys.stderr)

    write_json(out_dir / "manifest.json", {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "envs": envs,
    })
    return 0 if any(s["ok"] for s in envs.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
