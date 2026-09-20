#!/usr/bin/env python3
"""
Fetch AMFI's daily NAV file and write a compact nav.json that the Fund
Ledger app reads directly (same-origin, so no browser CORS problem).

AMFI's file mixes section headers, AMC name lines, and blank lines in
with the real data rows, and its column layout has changed over the
years (sometimes 6 fields, sometimes 8 with Plan/Option split out) —
this handles both.
"""
import json
import urllib.request

SOURCE_URLS = [
    "https://www.amfiindia.com/spages/NAVAll.txt",
    "https://portal.amfiindia.com/spages/NAVAll.txt",
]


def fetch_text():
    last_err = None
    for url in SOURCE_URLS:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except Exception as e:  # noqa: BLE001
            last_err = e
    raise SystemExit(f"Could not fetch AMFI NAV file from any source: {last_err}")


def parse(text):
    data = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or ";" not in line:
            continue
        parts = line.split(";")
        code = parts[0].strip()
        if not code.isdigit():
            continue  # section headers / AMC name lines have no numeric scheme code
        if len(parts) >= 8:
            # Scheme Code;ISIN Payout;ISIN Reinvest;Scheme Name;Plan;Option;NAV;Date
            name, plan, option, nav_str, date_str = (
                parts[3], parts[4], parts[5], parts[6], parts[7]
            )
            full_name = " - ".join(p.strip() for p in (name, plan, option) if p.strip())
        elif len(parts) >= 6:
            # Older format: Scheme Code;ISIN Payout;ISIN Reinvest;Scheme Name;NAV;Date
            name, nav_str, date_str = parts[3], parts[4], parts[5]
            full_name = name.strip()
        else:
            continue
        try:
            nav = float(nav_str)
        except ValueError:
            continue
        data[code] = {"name": full_name, "nav": nav, "date": date_str.strip()}
    return data


def main():
    text = fetch_text()
    data = parse(text)
    if len(data) < 1000:
        # Safety net: don't let a malformed/partial fetch clobber a good nav.json.
        raise SystemExit(
            f"Parsed suspiciously few schemes ({len(data)}) — aborting without writing."
        )
    with open("nav.json", "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"Wrote {len(data)} schemes to nav.json")


if __name__ == "__main__":
    main()
