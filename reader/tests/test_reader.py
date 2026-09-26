import base64
import random
from datetime import date

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from paperlog import api, handwriting, timeline, vision
from synth import fake_month, photograph, render_page


def _pages(seed, hard=True, n_rows=None):
    rnd = random.Random(seed)
    rows = fake_month(n_rows or rnd.randint(8, 31), seed=seed)
    return rnd, rows, render_page("left", rows, rnd, hard=hard), render_page("right", rows, rnd, hard=hard)


def _cell_errors(page, rows):
    half = slice(0, 24) if page.side == "left" else slice(24, 48)
    return sum(a != b for r, row in enumerate(rows)
               for a, b in zip(page.sleep[r], row["sleep"][half] if row else "." * 24))


@pytest.mark.parametrize("seed", range(4))
def test_single_pages(seed):
    rnd, rows, left, right = _pages(seed)
    for img, side in ((left, "left"), (right, "right")):
        [page] = vision.read_photo(photograph([img], rnd))
        assert page.side == side
        assert _cell_errors(page, rows) <= 2


def test_spread_photo_finds_both_pages():
    rnd, rows, left, right = _pages(7)
    pages = vision.read_photo(photograph([left, right], rnd, max_dim=1600))
    assert [p.side for p in pages] == ["left", "right"]
    assert sum(_cell_errors(p, rows) for p in pages) <= 3


def test_no_frame_is_a_clear_error():
    img = np.full((1000, 800, 3), 235, np.uint8)
    cv2.putText(img, "just a shopping list", (50, 300), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (20, 20, 20), 3)
    ok, buf = cv2.imencode(".jpg", img)
    with pytest.raises(vision.ReadError):
        vision.read_photo(buf.tobytes())


def test_events_join_sleep_across_7pm_and_use_sgt():
    r1 = "." * 44 + "SSSS"              # row 1: asleep 5pm-7pm on 1 Oct
    r2 = "SS" + "." * 46                # row 2: continues 7pm-8pm on 1 Oct
    ev = timeline.events(date(2026, 10, 1), [{"row": 1, "sleep": r1, "feeds": [3]},
                                             {"row": 2, "sleep": r2, "feeds": []}])
    sleeps = [e for e in ev if e["kind"] == "sleep"]
    assert len(sleeps) == 1
    assert sleeps[0]["start_at"] == "2026-10-01T17:00:00+08:00"
    assert sleeps[0]["end_at"] == "2026-10-01T20:00:00+08:00"
    feed = next(e for e in ev if e["kind"] == "feed")
    assert feed["start_at"] == "2026-09-30T20:30:00+08:00"   # row 1 starts 7pm on 30 Sep


def test_row_stats():
    s = timeline.row_stats("S" * 16 + "." * 8 + "SS" + "." * 10 + "SSS" + "." * 9, [0, 30])
    assert s["night_sleep_min"] == 480 and s["naps"] == 2 and s["longest_stretch_min"] == 480


def test_api_end_to_end(monkeypatch):
    monkeypatch.delenv("READER_KEY", raising=False)
    rnd, rows, left, right = _pages(3, n_rows=12)
    fake_text = {r: {"row": r, "date_text": r if r != 5 else 6, "wet": 5, "dirty": 2} for r in range(1, 13)}
    monkeypatch.setattr(handwriting, "read", lambda l, rr, want: {r: fake_text[r] for r in want if r in fake_text})
    client = TestClient(api.app)
    files = [("images", ("a.jpg", photograph([left], rnd), "image/jpeg")),
             ("images", ("b.jpg", photograph([right], rnd), "image/jpeg"))]
    res = client.post("/v1/read-spread", files=files)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["complete"] and body["sides"] == ["left", "right"]
    got = {r["row"]: r for r in body["rows"]}
    assert all(got[i]["sleep"] == rows[i - 1]["sleep"] for i in range(1, 13))
    assert got[13]["blank"] and not got[12]["blank"]
    assert got[3]["wet"] == 5
    assert any("Line 5" in w for w in body["warnings"])
    assert base64.b64decode(body["overlay_jpeg_b64"])[:2] == b"\xff\xd8"

    ev = client.post("/v1/events", json={"month": "2026-10", "rows": [
        {"row": r["row"], "sleep": r["sleep"], "feeds": r["feeds"]} for r in body["rows"] if not r["blank"]]})
    assert ev.status_code == 200 and ev.json()["events"]


def test_reader_key_enforced(monkeypatch):
    monkeypatch.setenv("READER_KEY", "s3cret")
    client = TestClient(api.app)
    assert client.post("/v1/events", json={"month": "2026-10", "rows": []}).status_code == 401
    ok = client.post("/v1/events", json={"month": "2026-10", "rows": []}, headers={"X-Reader-Key": "s3cret"})
    assert ok.status_code == 200


def test_handwriting_composite_builds():
    rnd, rows, left, right = _pages(2, n_rows=5)
    pages = vision.read_photo(photograph([left, right], rnd, max_dim=2000))
    png = handwriting.build_composite(pages[0].image, pages[1].image, [1, 2, 3])
    img = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_COLOR)
    assert img.shape[0] > 3 * 100
