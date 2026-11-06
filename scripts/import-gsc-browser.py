"""Normalize Google Search Console Web performance CSV ZIP exports for local import."""

import argparse
import csv
import json
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from zipfile import ZipFile


def csv_rows(archive, *names):
    name = next(name for name in names if name in archive.namelist())
    return list(csv.reader(archive.read(name).decode("utf-8-sig").splitlines()))


def read_report(path, property_id, finalized_through):
    with ZipFile(path) as archive:
        chart = csv_rows(archive, "图表.csv", "Chart.csv")
        pages = csv_rows(archive, "网页.csv", "Pages.csv")
        filters = dict(csv_rows(archive, "过滤器.csv", "Filters.csv")[1:])
    if len(chart) != 2 or len(chart[1]) != 5 or len(pages[0]) != 5:
        raise ValueError("expected a single-day report with all four metrics")
    day = date.fromisoformat(chart[1][0])
    if filters.get("搜索类型", filters.get("Search type")) not in ("网页（基于文本）", "Web"):
        raise ValueError("expected the Web search type")
    if set(filters) - {"搜索类型", "Search type", "日期", "Date"}:
        raise ValueError("unexpected report filters")
    if "日期" in filters:
        label = f"{day.year}年{day.month}月{day.day}日"
        if filters["日期"] != f"{label}-{label}":
            raise ValueError("chart date disagrees with the selected single-day filter")
    rows = []
    seen = set()
    for url, clicks, impressions, _ctr, position in pages[1:]:
        address = urlsplit(url)
        if address.scheme not in ("http", "https") or not address.hostname or url in seen:
            raise ValueError("invalid or duplicate page URL")
        seen.add(url)
        rows.append({"url": url, "clicks": int(clicks), "impressions": int(impressions), "position": float(position)})
    observed_at = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "kind": "gsc-pages", "date": day.isoformat(), "observedAt": observed_at,
        "source": "browser-export", "complete": bool(rows) and len(rows) < 1000 and day <= finalized_through,
        "property": property_id, "rows": rows,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--property", required=True)
    parser.add_argument("--finalized-through", required=True, type=date.fromisoformat)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("archives", nargs="+", type=Path)
    options = parser.parse_args()
    reports = {}
    for archive in options.archives:
        report = read_report(archive, options.property, options.finalized_through)
        previous = reports.get(report["date"])
        if previous is None or report["observedAt"] > previous["observedAt"]:
            reports[report["date"]] = report
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps([reports[day] for day in sorted(reports)], ensure_ascii=False), encoding="utf-8")
    print(f"Imported {len(reports)} dates, {sum(len(report['rows']) for report in reports.values())} page rows")


if __name__ == "__main__":
    main()
