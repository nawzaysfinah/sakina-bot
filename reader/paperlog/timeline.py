"""Turn page rows into dated rows, daily stats and sleep/feed events."""
from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from . import layout as L

CELLS = 2 * L.CELLS_PER_PAGE      # 48 half-hours per row
UNKNOWN = " "                     # half of the spread not photographed


def row_date(month: date, row: int) -> date:
    """Row N is the night leading into day N, then day N."""
    return date(month.year, month.month, row)


def row_start(month: date, row: int, tz: ZoneInfo) -> datetime:
    d = row_date(month, row) - timedelta(days=1)
    return datetime(d.year, d.month, d.day, L.DAY_START_HOUR, tzinfo=tz)


def cell_time(month: date, row: int, cell: int, tz: ZoneInfo) -> datetime:
    return row_start(month, row, tz) + timedelta(minutes=L.CELL_MINUTES * cell)


def parse_month(s: str) -> date:
    y, m = s.split("-")[:2]
    return date(int(y), int(m), 1)


def merge_spread(left, right) -> list[dict]:
    """Join a left and right Page (either may be None) into 31 rows of 48 cells."""
    rows = []
    for r in range(L.ROWS):
        ls = left.sleep[r] if left else UNKNOWN * 24
        rs = right.sleep[r] if right else UNKNOWN * 24
        feeds = (left.feeds[r] if left else []) + [24 + c for c in (right.feeds[r] if right else [])]
        unsure = (left.uncertain[r] if left else []) + [24 + c for c in (right.uncertain[r] if right else [])]
        date_ink = bool(left and left.side_ink[r])
        tally_ink = bool(right and right.side_ink[r])
        sleep = ls + rs
        blank = "S" not in sleep and not feeds and not date_ink and not tally_ink
        rows.append({"row": r + 1, "sleep": sleep, "feeds": sorted(feeds), "uncertain": sorted(unsure),
                     "date_ink": date_ink, "tally_ink": tally_ink, "blank": blank})
    return rows


def _runs(s: str, ch: str = "S"):
    i = 0
    while i < len(s):
        if s[i] == ch:
            j = i
            while j < len(s) and s[j] == ch:
                j += 1
            yield i, j
            i = j
        else:
            i += 1


def row_stats(sleep: str, feeds: list[int]) -> dict:
    m = L.CELL_MINUTES
    night, day = sleep[:24], sleep[24:]
    runs = list(_runs(sleep))
    return {
        "sleep_min": sleep.count("S") * m,
        "night_sleep_min": night.count("S") * m,
        "day_sleep_min": day.count("S") * m,
        "naps": sum(1 for a, b in _runs(day)),
        "longest_stretch_min": max(((b - a) * m for a, b in runs), default=0),
        "feeds": len(feeds),
        "complete": UNKNOWN not in sleep,
    }


def events(month: date, rows: list[dict], tz_name: str = "Asia/Singapore") -> list[dict]:
    """Sleep and feed events for the given confirmed rows of one month.

    Sleep that runs past 7pm continues into the next row. A run touching a row
    that isn't in `rows` (or the month edge) is flagged open_start / open_end so
    the caller can join it to a neighbouring month's event if it wants to.
    """
    tz = ZoneInfo(tz_name)
    days = calendar.monthrange(month.year, month.month)[1]
    by_row = {r["row"]: r for r in rows if 1 <= r["row"] <= days}
    out = []

    # Walk the month as one long strip; missing rows break it.
    strip, index = [], []          # index[i] = (row, cell)
    for row in range(1, days + 2):
        r = by_row.get(row)
        if r is None:
            out += _strip_events(strip, index, month, tz)
            strip, index = [], []
            continue
        for c, ch in enumerate(r["sleep"]):
            strip.append(ch)
            index.append((row, c))
    out += _strip_events(strip, index, month, tz)

    for r in by_row.values():
        for c in r.get("feeds", []):
            t = cell_time(month, r["row"], c, tz)
            out.append({"kind": "feed", "start_at": t.isoformat(), "end_at": None,
                        "row_date": row_date(month, r["row"]).isoformat(), "precision_min": L.CELL_MINUTES})
    return sorted(out, key=lambda e: (e["start_at"], e["kind"]))


def _strip_events(strip, index, month, tz):
    out = []
    s = "".join(strip)
    for a, b in _runs(s):
        row_a, cell_a = index[a]
        row_b, cell_b = index[b - 1]
        start = cell_time(month, row_a, cell_a, tz)
        end = cell_time(month, row_b, cell_b, tz) + timedelta(minutes=L.CELL_MINUTES)
        out.append({"kind": "sleep", "start_at": start.isoformat(), "end_at": end.isoformat(),
                    "row_date": row_date(month, row_a).isoformat(), "precision_min": L.CELL_MINUTES,
                    "open_start": a == 0, "open_end": b == len(s)})
    return out
