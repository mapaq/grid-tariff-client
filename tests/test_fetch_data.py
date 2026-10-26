import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import fetch_data  # noqa: E402

BASE = "https://example.test/v0"
DYN = {"id": "abc-123", "type": "dynamic", "url": "/prices?product=GN6KWST"}
TARIFFS = {
    "tariffs": [
        {"product": "A", "powerPrice": {"components": [DYN]}},
        {"product": "B", "powerPrice": {"components": [DYN, {"id": "peak-1", "type": "peak"}]}},  # dubblett + icke-dynamisk
        {"product": "C", "powerPrice": {"components": [{"id": "no-url-id", "type": "dynamic", "url": None}]}},
        {"product": "D", "powerPrice": None},
    ],
    "calendarPatterns": [],
}
INFO = {"name": "Grid Tariff API"}


def fake_get(responses):
    def _get(url, *a, **k):
        r = responses.get(url)
        if isinstance(r, Exception):
            raise r
        if r is None:
            raise RuntimeError(f"oväntad url {url}")
        return r
    return _get


class PriceKeyTests(unittest.TestCase):
    def test_product_from_url(self):
        self.assertEqual(fetch_data.price_key(DYN), "GN6KWST")

    def test_component_id_in_url(self):
        self.assertEqual(fetch_data.price_key({"id": "x", "url": "/prices?componentId=abc-1"}), "abc-1")

    def test_fallback_to_component_id(self):
        self.assertEqual(fetch_data.price_key({"id": "no-url-id", "url": None}), "c-no-url-id")

    def test_sanitized(self):
        self.assertEqual(fetch_data.price_key({"id": "x", "url": "/prices?product=../../etc"}), "______etc")

    def test_query_never_takes_host_or_path(self):
        self.assertEqual(fetch_data.price_query({"id": "x", "url": "https://evil.test/other?product=P"}), "product=P")
        self.assertEqual(fetch_data.price_query({"id": "x"}), "componentId=x")


class FetchEnvTests(unittest.TestCase):
    def test_writes_files(self):
        responses = {
            f"{BASE}/info": INFO,
            f"{BASE}/tariffs": TARIFFS,
            f"{BASE}/prices?product=GN6KWST": {"prices": [1]},
            f"{BASE}/prices?componentId=no-url-id": {"prices": [2]},
        }
        with tempfile.TemporaryDirectory() as d, mock.patch.object(fetch_data, "get_json", fake_get(responses)):
            out = Path(d)
            st = fetch_data.fetch_env("prod", BASE, out)
            self.assertTrue(st["ok"])
            self.assertEqual((st["tariffs"], st["priceFiles"], st["priceErrors"]), (4, 2, 0))
            self.assertEqual(json.loads((out / "prod/info.json").read_text()), INFO)
            self.assertEqual(json.loads((out / "prod/prices/GN6KWST.json").read_text()), {"prices": [1]})
            self.assertEqual(json.loads((out / "prod/prices/c-no-url-id.json").read_text()), {"prices": [2]})

    def test_price_failure_is_recorded_but_env_ok(self):
        responses = {
            f"{BASE}/info": INFO,
            f"{BASE}/tariffs": TARIFFS,
            f"{BASE}/prices?product=GN6KWST": RuntimeError("HTTP 500"),
            f"{BASE}/prices?componentId=no-url-id": {"prices": []},
        }
        with tempfile.TemporaryDirectory() as d, mock.patch.object(fetch_data, "get_json", fake_get(responses)):
            st = fetch_data.fetch_env("uat", BASE, Path(d))
            self.assertTrue(st["ok"])
            self.assertEqual(st["priceErrors"], 1)
            self.assertIn("error", json.loads((Path(d) / "uat/prices/GN6KWST.json").read_text()))

    def test_tariff_failure_writes_nothing(self):
        responses = {f"{BASE}/info": INFO, f"{BASE}/tariffs": RuntimeError("HTTP 503")}
        with tempfile.TemporaryDirectory() as d, mock.patch.object(fetch_data, "get_json", fake_get(responses)):
            st = fetch_data.fetch_env("prod", BASE, Path(d))
            self.assertFalse(st["ok"])
            self.assertIn("503", st["error"])
            self.assertFalse((Path(d) / "prod").exists())


class MainTests(unittest.TestCase):
    def run_main(self, ok_envs):
        def fake_fetch_env(env, base, out):
            return {"ok": env in ok_envs, "fetchedAt": "t", "error": "boom",
                    "tariffs": 1, "priceFiles": 0, "priceErrors": 0}
        with tempfile.TemporaryDirectory() as d, mock.patch.object(fetch_data, "fetch_env", fake_fetch_env):
            code = fetch_data.main(["--out", d])
            manifest = json.loads((Path(d) / "manifest.json").read_text())
        return code, manifest

    def test_ok_if_any_env_ok(self):
        code, manifest = self.run_main({"prod"})
        self.assertEqual(code, 0)
        self.assertFalse(manifest["envs"]["uat"]["ok"])
        self.assertTrue(manifest["envs"]["prod"]["ok"])

    def test_fail_if_no_env_ok(self):
        code, _ = self.run_main(set())
        self.assertEqual(code, 1)


if __name__ == "__main__":
    unittest.main()
