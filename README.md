# grid-tariff-client

A simple client that reads tariff data from the Swedish **Grid Tariff API** ([Eltariff-API](https://github.com/RI-SE/Eltariff-API))
and shows the tariffs and their hourly prices. It is currently set up for **Göteborg Energi Nät** and can switch between
their **UAT** and **Prod** environments.

**Live site:** https://mapaq.github.io/grid-tariff-client/ (the UI is in Swedish)

## What it shows

- All tariffs (consumption and feed-in) with fixed fee, energy price and power price, with or without VAT.
- Time-of-use tariffs ("Tidsindelad"): the high/low price for every hour of the chosen date, derived from the
  tariff rules, the weekday/weekend patterns and the holiday list in the API response.
- Hourly-priced tariffs ("timpris"): the hourly prices from the `/prices` endpoint, as a chart with min/max/average.
- A date picker, a UAT/Prod switch and a free-text filter. "Raw data" panels show exactly what the API returned.

## How it works

The API does not send CORS headers, so a web page cannot call it directly from the browser. Instead:

```
GitHub Actions (hourly) ──► scripts/fetch_data.py ──► data/{uat,prod}/*.json ──► GitHub Pages
                                                                 ▲
                                                      index.html reads these
```

`index.html` detects `data/manifest.json` and reads the snapshots. Without it (running locally via `server.py`)
it falls back to **live** mode, where `server.py` proxies `/api/{uat,prod}/…` to the API.

Because snapshots are fetched once an hour, hourly prices cover the period the API returns by default
(today + 7 days). Time-of-use profiles are calculated from the rules and work for any date.

## Run locally

Live data via the proxy (needs Python 3.8+, no packages):

```
python3 server.py            # Windows: py server.py  →  http://localhost:8000
```

Snapshot mode, exactly like the published site:

```
python3 scripts/fetch_data.py --out data
python3 -m http.server 8000  # → http://localhost:8000
```

Add `?env=uat` or `?source=live` to the URL to force an environment or the live mode.

## Tests

```
python3 -m unittest discover -s tests -v   # fetch script
node tests/page.test.js                    # page logic (snapshot and live mode), no dependencies
```

Both run on every pull request and before every publish.

## Publishing (one-time setup)

1. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Merge to `main`, or run the workflow manually from the **Actions** tab. After that it runs every hour.

Note: GitHub disables scheduled workflows in public repositories after 60 days without repository activity.
If the site stops updating, re-enable the workflow in the Actions tab (or push a commit).

## Data and disclaimer

This is a private open source project and is not affiliated with Göteborg Energi or any other grid company.
The data is fetched from the grid company's public API, which follows the [Eltariff-API](https://github.com/RI-SE/Eltariff-API)
standard. Always verify prices and tariffs directly with the source. The MIT license covers this code only, not the data.

## License

[MIT](LICENSE)
