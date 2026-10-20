"""HTTP service Sakina calls.

POST /v1/read-spread   1-2 photos -> 31 rows of 48 cells, stats, overlay image
POST /v1/events        confirmed rows for a month -> sleep/feed events
GET  /health

Photos are processed in memory and never written to disk.
"""
from __future__ import annotations

import logging
import os

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from . import handwriting, overlay, timeline, vision

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="Sakina paper log reader", version="1.0")
MAX_BYTES = 15 * 1024 * 1024


def auth(x_reader_key: str | None = Header(default=None)):
    want = os.environ.get("READER_KEY")
    if want and x_reader_key != want:
        raise HTTPException(401, "bad reader key")


@app.get("/health")
def health():
    return {"ok": True, "handwriting": bool(os.environ.get("GEMINI_API_KEY"))}


@app.post("/v1/read-spread", dependencies=[Depends(auth)])
async def read_spread(images: list[UploadFile] = File(...)):
    if not 1 <= len(images) <= 2:
        raise HTTPException(400, "Send one or two photos.")
    pages, warnings = [], []
    for i, up in enumerate(images):
        data = await up.read()
        if len(data) > MAX_BYTES:
            raise HTTPException(413, "Photo too large.")
        hint = ["left", "right"][i] if len(images) == 2 else None
        try:
            got = vision.read_photo(data, side_hint=hint)
        except vision.ReadError as e:
            raise HTTPException(422, str(e))
        pages += got

    left = next((p for p in pages if p.side == "left"), None)
    right = next((p for p in pages if p.side == "right"), None)
    if len(pages) >= 2 and (left is None or right is None):
        # Two photos that both look like the same side: trust the order they came in.
        if pages[0].side_confidence < 0.25 or pages[1].side_confidence < 0.25:
            left = vision.read_page(pages[0].image, force_side="left")
            right = vision.read_page(pages[1].image, force_side="right")
            warnings.append("Couldn't tell the pages apart, so I took the first photo as the left page.")
        else:
            raise HTTPException(422, f"Both photos look like the {pages[0].side} page.")
    for p in (left, right):
        if p:
            warnings += p.warnings

    rows = timeline.merge_spread(left, right)
    want = [r["row"] for r in rows if r["date_ink"] or r["tally_ink"]]
    text = handwriting.read(left.image if left else None, right.image if right else None, want) or {}
    for r in rows:
        t = text.get(r["row"], {})
        r["date_text"] = t.get("date_text")
        r["wet"] = t.get("wet")
        r["dirty"] = t.get("dirty")
        r["stats"] = timeline.row_stats(r["sleep"], r["feeds"])
        if r["date_text"] is not None and r["date_text"] != r["row"]:
            warnings.append(f"Line {r['row']} has the date {r['date_text']} written on it. "
                            "Was a line skipped?")

    return {
        "sides": [s for s, p in (("left", left), ("right", right)) if p],
        "complete": bool(left and right),
        "handwriting": bool(text),
        "rows": rows,
        "warnings": warnings,
        "overlay_jpeg_b64": overlay.spread_jpeg_b64(left, right),
    }


class EventRow(BaseModel):
    row: int = Field(ge=1, le=31)
    sleep: str = Field(min_length=48, max_length=48)
    feeds: list[int] = []


class EventsIn(BaseModel):
    month: str = Field(pattern=r"^\d{4}-\d{2}$")
    tz: str = "Asia/Singapore"
    rows: list[EventRow]


@app.post("/v1/events", dependencies=[Depends(auth)])
def make_events(body: EventsIn):
    month = timeline.parse_month(body.month)
    return {"events": timeline.events(month, [r.model_dump() for r in body.rows], body.tz)}
