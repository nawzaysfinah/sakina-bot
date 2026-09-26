"""Render fake notebook photos with known contents, for testing the reader."""
from __future__ import annotations

import random

import cv2
import numpy as np

from paperlog import layout as L

PX = 12  # px per mm for the "real" page


def mm(v):
    return int(round(v * PX))


def fake_month(n_rows=20, seed=0):
    """Plausible newborn-ish pattern: long-ish night stretches, day naps, feeds on waking."""
    rnd = random.Random(seed)
    rows = []
    for r in range(L.ROWS):
        if r >= n_rows:
            rows.append(None)
            continue
        cells = ["."] * 48
        t = rnd.randint(0, 3)
        while t < 48:
            nap = rnd.randint(2, 8 if t < 24 else 5)      # longer at night
            for i in range(t, min(48, t + nap)):
                cells[i] = "S"
            t += nap + rnd.randint(1, 4)
        feeds = sorted({i for i in range(48) if cells[i] == "." and rnd.random() < 0.22})
        rows.append({"sleep": "".join(cells), "feeds": feeds,
                     "wet": rnd.randint(4, 8), "dirty": rnd.randint(0, 4)})
    return rows


def _paper(w, h, rnd):
    base = np.full((h, w, 3), (228, 236, 241), np.uint8).astype(np.int16)
    base += np.random.default_rng(rnd.randint(0, 999)).integers(-6, 6, (h, w, 1), dtype=np.int16)
    return np.clip(base, 0, 255).astype(np.uint8)


def _wobbly_rect(img, x0, y0, x1, y1, th, rnd):
    pts = []
    for (ax, ay), (bx, by) in [((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)),
                               ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))]:
        for t in np.linspace(0, 1, 12):
            pts.append((ax + (bx - ax) * t + rnd.uniform(-2, 2), ay + (by - ay) * t + rnd.uniform(-2, 2)))
    cv2.polylines(img, [np.array(pts, np.int32)], True, (25, 25, 30), th, cv2.LINE_AA)


def render_page(side, rows, rnd, dot_colour="red", hard=False):
    W, H = mm(L.PAGE_W_MM), mm(L.PAGE_H_MM)
    img = _paper(W, H, rnd)
    fx = L.OUTER_MARGIN_MM if side == "left" else L.SPINE_MARGIN_MM
    fy = L.TOP_MARGIN_MM
    # notebook grid, aligned to the frame
    for gx in np.arange(fx % 5, L.PAGE_W_MM, 5):
        cv2.line(img, (mm(gx), 0), (mm(gx), H), (205, 200, 190), 1)
    for gy in np.arange(fy % 5, L.PAGE_H_MM, 5):
        cv2.line(img, (0, mm(gy)), (W, mm(gy)), (205, 200, 190), 1)

    ink = (25, 25, 30)
    off = 0.4
    _wobbly_rect(img, mm(fx + off), mm(fy + off), mm(fx + L.FRAME_W_MM - off),
                 mm(fy + L.FRAME_H_MM - off), mm(0.8), rnd)
    cv2.line(img, (mm(fx), mm(fy + 5)), (mm(fx + L.FRAME_W_MM), mm(fy + 5)), ink, mm(0.35))
    div = fx + (L.SIDE_COL_MM if side == "left" else L.CELLS_MM)
    cv2.line(img, (mm(div), mm(fy)), (mm(div), mm(fy + L.FRAME_H_MM)), ink, mm(0.35))

    cx0 = fx + (L.SIDE_COL_MM if side == "left" else 0)
    for i, lab in enumerate(["7", "9", "11", "1", "3", "5"]):
        cv2.putText(img, lab, (mm(cx0 + i * 20 + 0.6), mm(fy + 4)), cv2.FONT_HERSHEY_SIMPLEX, 1.0, ink, 2, cv2.LINE_AA)
    if side == "left":
        cv2.putText(img, "October", (mm(fx + 2), mm(fy - 6)), cv2.FONT_HERSHEY_SCRIPT_SIMPLEX, 2.2, ink, 3, cv2.LINE_AA)

    half = slice(0, 24) if side == "left" else slice(24, 48)
    for r, row in enumerate(rows):
        if row is None:
            continue
        y = fy + (r + 1) * 5
        if side == "left":
            cv2.putText(img, str(r + 1), (mm(fx + 3), mm(y + 4)), cv2.FONT_HERSHEY_SCRIPT_SIMPLEX, 1.4, ink, 3, cv2.LINE_AA)
        else:
            cv2.putText(img, f"{row['wet']}.{row['dirty']}", (mm(fx + L.CELLS_MM + 2), mm(y + 4)),
                        cv2.FONT_HERSHEY_SCRIPT_SIMPLEX, 1.3, ink, 3, cv2.LINE_AA)
        cells = row["sleep"][half]
        for c, s in enumerate(cells):
            x = cx0 + c * 5
            if s == "S":
                spacing = rnd.uniform(0.9, 1.6) if hard else rnd.uniform(0.6, 1.0)
                pen = 0.45 if hard else 0.55
                m = [rnd.uniform(-0.5, 0.9) if hard else 0.3 for _ in range(4)]
                box = (mm(x + m[0]), mm(y + m[1]), mm(5 - m[0] - m[2]), mm(5 - m[1] - m[3]))
                ang = rnd.choice([1, -1])
                for d in np.arange(-5, 5, spacing):
                    a = (mm(x + d), mm(y + 5)) if ang > 0 else (mm(x + d), mm(y))
                    b = (mm(x + d + 5), mm(y)) if ang > 0 else (mm(x + d + 5), mm(y + 5))
                    ok, p0, p1 = cv2.clipLine(box, a, b)
                    if ok:
                        cv2.line(img, p0, p1, ink, mm(pen), cv2.LINE_AA)
        for f in row["feeds"]:
            if (side == "left") != (f < 24):
                continue
            c = f % 24
            colour = (40, 40, 200) if dot_colour == "red" else ink
            cv2.circle(img, (mm(cx0 + c * 5 + 2.5 + rnd.uniform(-.6, .6)), mm(y + 2.5 + rnd.uniform(-.6, .6))),
                       mm(1.1), colour, -1, cv2.LINE_AA)
    return img


def photograph(pages, rnd, max_dim=1280, table=(60, 80, 105), curl=0.0):
    """Put page(s) on a table, tilt the camera, add light falloff, blur, JPEG."""
    gap = 8
    h = pages[0].shape[0]
    spread = np.concatenate([pages[0]] + ([np.full((h, gap, 3), 120, np.uint8), pages[1]] if len(pages) > 1 else []), axis=1)
    sh, sw = spread.shape[:2]
    pad = int(0.18 * max(sh, sw))
    canvas_w, canvas_h = sw + 2 * pad, sh + 2 * pad
    src = np.array([[0, 0], [sw, 0], [sw, sh], [0, sh]], np.float32)
    j = 0.06 * min(sw, sh)
    dst = np.array([[pad + rnd.uniform(-j, j), pad + rnd.uniform(-j, j)],
                    [pad + sw + rnd.uniform(-j, j), pad + rnd.uniform(-j, j)],
                    [pad + sw + rnd.uniform(-j, j), pad + sh + rnd.uniform(-j, j)],
                    [pad + rnd.uniform(-j, j), pad + sh + rnd.uniform(-j, j)]], np.float32)
    M = cv2.getPerspectiveTransform(src, dst)
    bg = np.full((canvas_h, canvas_w, 3), table, np.uint8)
    if curl:  # pages lift toward the camera near the spine
        yy, xx = np.mgrid[0:sh, 0:sw].astype(np.float32)
        near = np.exp(-(((xx - sw / 2) / (0.12 * sw)) ** 2))
        map_y = (yy - sh / 2) * (1 - curl * near) + sh / 2
        map_x = xx + curl * 40 * near * np.sign(xx - sw / 2)
        spread = cv2.remap(spread, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    out = cv2.warpPerspective(spread, M, (canvas_w, canvas_h), dst=bg, borderMode=cv2.BORDER_TRANSPARENT)
    gx, gy = np.meshgrid(np.linspace(0, 1, canvas_w), np.linspace(0, 1, canvas_h))
    a, b = rnd.uniform(-.25, .25), rnd.uniform(-.25, .25)
    light = np.clip(0.85 + a * (gx - .5) + b * (gy - .5) - 0.15 * ((gx - .5) ** 2 + (gy - .5) ** 2), 0.5, 1.1)
    out = np.clip(out * light[..., None], 0, 255).astype(np.uint8)
    out = cv2.GaussianBlur(out, (0, 0), rnd.uniform(0.6, 1.4))
    s = max_dim / max(out.shape[:2])
    out = cv2.resize(out, (int(out.shape[1] * s), int(out.shape[0] * s)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 78])
    return buf.tobytes()
