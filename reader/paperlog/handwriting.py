"""Read the handwritten bits with Gemini: dates and diaper tallies.

Only small crops leave the server: the date column, the tally column and the
line above the frame. The sleep grid itself never goes to Gemini.
Without GEMINI_API_KEY this step is skipped and dates come from row numbers.
"""
from __future__ import annotations

import json
import logging
import os

import cv2
import numpy as np
from pydantic import BaseModel

from . import layout as L

log = logging.getLogger(__name__)
MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

PROMPT = """This image is made of strips cut from a parent's handwritten baby log.
Each strip starts with a printed label "row N". After it come up to two handwritten boxes:
  DATE  - a day-of-month number the parent wrote (may be missing)
  W.D   - diaper counts written as "wet.dirty" (e.g. "5.2", "6-1", "5/2") or as tally marks
          before and after a separator (may be missing)
Read exactly what is written. If a box is empty, blank, or unreadable, return null for it.
Do not guess or fill in values from neighbouring rows."""


class RowText(BaseModel):
    row: int
    date_text: int | None
    wet: int | None
    dirty: int | None


class PageText(BaseModel):
    rows: list[RowText]


def _label(text: str, w: int, h: int) -> np.ndarray:
    img = np.full((h, w, 3), 255, np.uint8)
    cv2.putText(img, text, (8, int(h * 0.68)), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 2, cv2.LINE_AA)
    return img


def build_composite(left_img, right_img, rows_wanted) -> bytes:
    """Stack one strip per row: [row N][date box][W.D box], upscaled 2x."""
    col = L.SIDE_COL_PX
    strips = []
    blank = np.full((L.CELL_PX, col, 3), 255, np.uint8)
    for r in rows_wanted:
        y = L.row_y0_px(r - 1)
        date_box = left_img[y:y + L.CELL_PX, 0:col] if left_img is not None else blank
        rx = L.side_col_x0_px("right")
        tally_box = right_img[y:y + L.CELL_PX, rx:rx + col] if right_img is not None else blank
        pair = np.hstack([date_box, np.full((L.CELL_PX, 12, 3), 255, np.uint8), tally_box])
        pair = cv2.resize(pair, (pair.shape[1] * 2, pair.shape[0] * 2), interpolation=cv2.INTER_CUBIC)
        strips.append(np.hstack([_label(f"row {r}", 160, pair.shape[0]), pair]))
    width = strips[0].shape[1]
    sep = np.full((6, width, 3), 200, np.uint8)
    body = np.vstack([x for s in strips for x in (s, sep)])
    ok, buf = cv2.imencode(".png", body)
    return buf.tobytes()


def read(left_img, right_img, rows_wanted: list[int]) -> dict[int, dict] | None:
    key = os.environ.get("GEMINI_API_KEY")
    if not key or not rows_wanted:
        return None
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        log.warning("google-genai not installed; skipping handwriting")
        return None
    png = build_composite(left_img, right_img, rows_wanted)
    try:
        client = genai.Client(api_key=key)
        resp = client.models.generate_content(
            model=MODEL,
            contents=[types.Part.from_bytes(data=png, mime_type="image/png"), PROMPT],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=PageText,
                temperature=0,
            ),
        )
        parsed = PageText.model_validate(json.loads(resp.text))
    except Exception as e:  # handwriting is a nice-to-have; never fail the scan
        log.warning("Gemini handwriting read failed: %s", e)
        return None
    return {r.row: r.model_dump() for r in parsed.rows if r.row in rows_wanted}
