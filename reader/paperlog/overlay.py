"""Draw what the reader saw on top of the straightened pages, so a parent can
check it against the notebook at a glance."""
from __future__ import annotations

import base64

import cv2
import numpy as np

from . import layout as L

SLEEP = (183, 74, 83)      # BGR purple
FEED = (48, 90, 216)       # BGR coral
UNSURE = (23, 159, 239)    # BGR amber


def draw_page(page) -> np.ndarray:
    img = page.image.copy()
    tint = img.copy()
    x0 = L.cells_x0_px(page.side)
    for r in range(L.ROWS):
        y = L.row_y0_px(r)
        for c, s in enumerate(page.sleep[r]):
            if s == "S":
                x = x0 + c * L.CELL_PX
                cv2.rectangle(tint, (x + 3, y + 3), (x + L.CELL_PX - 3, y + L.CELL_PX - 3), SLEEP, -1)
    img = cv2.addWeighted(tint, 0.45, img, 0.55, 0)
    for r in range(L.ROWS):
        y = L.row_y0_px(r)
        for c in page.feeds[r]:
            x = x0 + c * L.CELL_PX
            cv2.circle(img, (x + L.CELL_PX // 2, y + L.CELL_PX // 2), 19, FEED, 5)
        for c in page.uncertain[r]:
            x = x0 + c * L.CELL_PX
            cv2.rectangle(img, (x + 2, y + 2), (x + L.CELL_PX - 2, y + L.CELL_PX - 2), UNSURE, 6)
    return img


def spread_jpeg_b64(left, right, width: int = 1400) -> str:
    imgs = [draw_page(p) for p in (left, right) if p is not None]
    gap = np.full((L.FRAME_H_PX, 40, 3), 255, np.uint8)
    both = imgs[0] if len(imgs) == 1 else np.hstack([imgs[0], gap, imgs[1]])
    s = width / both.shape[1]
    both = cv2.resize(both, (width, int(both.shape[0] * s)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", both, [cv2.IMWRITE_JPEG_QUALITY, 82])
    return base64.b64encode(buf.tobytes()).decode()
