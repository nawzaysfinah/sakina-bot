"""Find the hand-ruled frames in a photo, straighten them, and read the cells.

The frame is the thick black rectangle traced with the stencil. Everything else
(cell positions, rows, columns) is computed from the frame and layout.py, so the
notebook's own faint grid is never needed.
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field

import cv2
import numpy as np
from PIL import Image, ImageOps

from . import layout as L

WORK_DIM = 1600               # detection runs on a copy this size (long edge)

# Cell classification thresholds (fraction of the cell interior covered in ink).
SHADED_MIN = 0.40
EMPTY_MAX = 0.06
RED_FEED_MIN = 0.04
CELL_INSET_PX = 9             # ignore 0.9 mm around each cell edge (grid lines, overshoot)


class ReadError(Exception):
    pass


# ---------------------------------------------------------------- loading

def load_image(data: bytes) -> np.ndarray:
    """Decode bytes to BGR, honouring EXIF rotation."""
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img).convert("RGB")
    return cv2.cvtColor(np.asarray(img), cv2.COLOR_RGB2BGR)


# ---------------------------------------------------------------- illumination

def _flatten(v: np.ndarray) -> np.ndarray:
    """Divide out uneven lighting. Fits a smooth quadratic surface to the paper
    pixels, so big shaded areas don't get mistaken for shadow."""
    h, w = v.shape
    small = cv2.resize(v, (w // 8, h // 8), interpolation=cv2.INTER_AREA).astype(np.float32)
    thr, _ = cv2.threshold(small.astype(np.uint8), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    ys, xs = np.nonzero(small > thr)
    if len(xs) < 50:
        return v.astype(np.float32) / max(float(v.max()), 1.0)
    vals = small[ys, xs]
    xn, yn = xs / small.shape[1], ys / small.shape[0]
    A = np.stack([np.ones_like(xn), xn, yn, xn * xn, yn * yn, xn * yn], axis=1)
    coef, *_ = np.linalg.lstsq(A, vals, rcond=None)
    gx, gy = np.meshgrid(np.linspace(0, 1, w), np.linspace(0, 1, h))
    surf = (coef[0] + coef[1] * gx + coef[2] * gy + coef[3] * gx * gx
            + coef[4] * gy * gy + coef[5] * gx * gy)
    return v.astype(np.float32) / np.maximum(surf, 1.0)


def _ink_masks(bgr: np.ndarray):
    """Return (dark_ink, red_ink) boolean masks."""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    norm = _flatten(v)
    red = ((h < 10) | (h > 165)) & (s > 90) & (v > 50)
    dark = (norm < 0.60) & ~red
    return dark, red


# ---------------------------------------------------------------- frame finding

def _order(pts: np.ndarray) -> np.ndarray:
    pts = pts.reshape(4, 2).astype(np.float32)
    s, d = pts.sum(1), np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)],
                     pts[np.argmax(s)], pts[np.argmax(d)]], dtype=np.float32)


def _quad_from_contour(cnt: np.ndarray):
    hull = cv2.convexHull(cnt)
    peri = cv2.arcLength(hull, True)
    for eps in np.linspace(0.01, 0.08, 15):
        approx = cv2.approxPolyDP(hull, eps * peri, True)
        if len(approx) == 4:
            return _order(approx)
    return None


def _refine(quad: np.ndarray, cnt: np.ndarray) -> np.ndarray:
    """Fit a straight line to each side of the traced frame and intersect them,
    so small bumps (a tick, a stray mark) don't pull the corners."""
    pts = cnt.reshape(-1, 2).astype(np.float32)
    lines = []
    for i in range(4):
        a, b = quad[i], quad[(i + 1) % 4]
        ab = b - a
        length = float(np.linalg.norm(ab))
        u = ab / length
        n = np.array([-u[1], u[0]])
        rel = pts - a
        t = rel @ u
        dist = np.abs(rel @ n)
        sel = pts[(t > 0.1 * length) & (t < 0.9 * length) & (dist < 0.02 * length + 2)]
        if len(sel) < 10:
            return quad
        vx, vy, x0, y0 = cv2.fitLine(sel, cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
        lines.append((np.array([x0, y0]), np.array([vx, vy])))
    out = []
    for i in range(4):
        (p1, d1), (p2, d2) = lines[i - 1], lines[i]
        M = np.array([d1, -d2]).T
        if abs(np.linalg.det(M)) < 1e-6:
            return quad
        t = np.linalg.solve(M, p2 - p1)
        out.append(p1 + t[0] * d1)
    return np.array(out, dtype=np.float32)


def find_frames(bgr: np.ndarray) -> list[np.ndarray]:
    """Return up to two frame quads (tl, tr, br, bl) in original pixel coords,
    sorted left to right."""
    H, W = bgr.shape[:2]
    scale = min(1.0, WORK_DIM / max(H, W))
    small = cv2.resize(bgr, (int(W * scale), int(H * scale)), interpolation=cv2.INTER_AREA)
    h, w = small.shape[:2]

    v = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)[..., 2]
    # Paper mask: keeps a dark table from looking like ink.
    blur = cv2.GaussianBlur(v, (0, 0), 3)
    _, paper = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if paper.mean() / 255 < 0.92:
        n, lab, stats, _ = cv2.connectedComponentsWithStats(paper)
        keep = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] > 0.08 * h * w]
        paper = np.isin(lab, keep).astype(np.uint8) * 255
        # fill holes (the frame interior is dark-ish when heavily shaded)
        cnts, _ = cv2.findContours(paper, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        paper = cv2.drawContours(np.zeros_like(paper), cnts, -1, 255, -1)
        paper = cv2.erode(paper, np.ones((9, 9), np.uint8))
    else:
        paper = np.full_like(paper, 255)

    dark, _ = _ink_masks(small)
    base = (dark & (paper > 0)).astype(np.uint8) * 255
    support = cv2.dilate(base, np.ones((5, 5), np.uint8))

    # Opening drops notebook grid lines, but also thin frame lines in small photos,
    # so collect candidates with and without it and keep the ones whose four sides
    # are really inked.
    cands = []
    for open_k in (3, 0):
        ink = base if not open_k else cv2.morphologyEx(base, cv2.MORPH_OPEN, np.ones((open_k, open_k), np.uint8))
        ink = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))  # heal pen gaps
        for q in _frames_in(ink, h, w):
            s_min = _edge_support(support, q)
            if s_min > 0.75:
                cands.append((s_min, q))
    chosen: list[np.ndarray] = []
    for s_min, q in sorted(cands, key=lambda t: -t[0]):
        c = q.mean(0)
        if all(not cv2.pointPolygonTest(o.reshape(-1, 1, 2), (float(c[0]), float(c[1])), False) >= 0
               for o in chosen):
            chosen.append(q)
        if len(chosen) == 2:
            break
    return sorted((q / scale for q in chosen), key=lambda q: q[:, 0].mean())


def _edge_support(mask: np.ndarray, q: np.ndarray) -> float:
    """Lowest fraction of inked points along any side of the quad."""
    h, w = mask.shape
    worst = 1.0
    for i in range(4):
        a, b = q[i], q[(i + 1) % 4]
        t = np.linspace(0.05, 0.95, 120)[:, None]
        pts = np.rint(a + (b - a) * t).astype(int)
        ok = (pts[:, 0] >= 0) & (pts[:, 0] < w) & (pts[:, 1] >= 0) & (pts[:, 1] < h)
        if not ok.all():
            return 0.0
        worst = min(worst, float((mask[pts[:, 1], pts[:, 0]] > 0).mean()))
    return worst


def _frames_in(ink: np.ndarray, h: int, w: int) -> list[np.ndarray]:
    cnts, _ = cv2.findContours(ink, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    found = []
    for c in sorted(cnts, key=cv2.contourArea, reverse=True)[:8]:
        if cv2.contourArea(cv2.convexHull(c)) < 0.04 * h * w:
            continue
        q = _quad_from_contour(c)
        if q is None:
            continue
        wq = (np.linalg.norm(q[1] - q[0]) + np.linalg.norm(q[2] - q[3])) / 2
        hq = (np.linalg.norm(q[3] - q[0]) + np.linalg.norm(q[2] - q[1])) / 2
        if not 0.55 < wq / hq < 1.15:          # expected 135/160 = 0.84
            continue
        found.append(_refine(q, c))
    return found


def warp(bgr: np.ndarray, quad: np.ndarray) -> np.ndarray:
    dst = np.array([[0, 0], [L.FRAME_W_PX, 0], [L.FRAME_W_PX, L.FRAME_H_PX],
                    [0, L.FRAME_H_PX]], dtype=np.float32)
    M = cv2.getPerspectiveTransform(quad.astype(np.float32), dst)
    return cv2.warpPerspective(bgr, M, (L.FRAME_W_PX, L.FRAME_H_PX), flags=cv2.INTER_AREA,
                               borderMode=cv2.BORDER_REPLICATE)


# ---------------------------------------------------------------- page reading

@dataclass
class Page:
    side: str                       # "left" | "right"
    side_confidence: float
    sleep: list[str]                # 31 strings of 24 chars: 'S' asleep, '.' awake/blank
    feeds: list[list[int]]          # per row, cell indexes with a feed dot
    uncertain: list[list[int]]      # per row, cell indexes that were guesses
    side_ink: list[bool]            # per row, something written in date/tally column
    image: np.ndarray = field(repr=False)   # warped page, for overlay + handwriting
    warnings: list[str] = field(default_factory=list)


def detect_side(dark: np.ndarray) -> tuple[str, float]:
    """The date/tally divider runs the full height of the frame: 15 mm from the
    left edge on the left page, 15 mm from the right edge on the right page."""
    col = dark.mean(axis=0)
    def band(x):
        return float(col[max(0, x - 12): x + 12].max())
    left_score = band(L.SIDE_COL_PX)
    right_score = band(L.FRAME_W_PX - L.SIDE_COL_PX)
    side = "left" if left_score > right_score else "right"
    conf = max(left_score, right_score) - min(left_score, right_score)
    return side, conf


def _classify(dark_cell: np.ndarray, red_cell: np.ndarray):
    """Return (state, feed, uncertain) for one cell interior."""
    cov = float(dark_cell.mean())
    feed = float(red_cell.mean()) >= RED_FEED_MIN
    if EMPTY_MAX < cov < 0.6 and not feed and _is_dot(dark_cell):
        return ".", True, False
    if cov >= SHADED_MIN:
        return "S", feed, False
    if cov <= EMPTY_MAX:
        return ".", feed, False
    # In between: a black feed dot, or light / partial shading.
    if _is_dot(dark_cell):
        return ".", True, False
    return ("S" if cov >= 0.25 else "."), feed, True


def _is_dot(dark_cell: np.ndarray) -> bool:
    """One solid, roundish blob that doesn't fill the cell = a feed dot drawn in
    the same pen as the shading."""
    n, _, stats, _ = cv2.connectedComponentsWithStats(dark_cell.astype(np.uint8))
    size = dark_cell.shape[0]
    blobs = [st for st in stats[1:] if st[4] > 0.03 * size * size]
    if len(blobs) != 1:
        return False
    x, y, w, h, area = blobs[0]
    return (w < 0.85 * size and h < 0.85 * size and 0.6 < w / max(h, 1) < 1.6
            and area / max(w * h, 1) > 0.6)


def _has_writing(region: np.ndarray) -> bool:
    """Handwriting in a date/tally box, ignoring the ruled lines that clip the
    box edges and specks of noise."""
    m = region.astype(np.uint8)
    rh, rw = m.shape
    lines = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (int(rw * 0.6), 1)))
    lines |= cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, int(rh * 0.95))))
    lines = cv2.dilate(lines, np.ones((5, 5), np.uint8))
    m = m & ~lines
    n, _, stats, _ = cv2.connectedComponentsWithStats(m)
    ink = sum(int(a) for a in stats[1:, 4] if a >= 20)
    return ink / m.size > 0.02


def read_page(warped: np.ndarray, side_hint: str | None = None,
              force_side: str | None = None) -> Page:
    dark, red = _ink_masks(warped)
    side, conf = detect_side(dark)
    warnings = []
    if force_side:
        side = force_side
    elif conf < 0.25:
        if side_hint:
            side = side_hint
            warnings.append(f"Couldn't see the column divider clearly, assumed this is the {side} page.")
        else:
            warnings.append("Couldn't see the column divider clearly.")

    x0 = L.cells_x0_px(side)
    k = CELL_INSET_PX
    sleep, feeds, unsure, side_ink = [], [], [], []
    for r in range(L.ROWS):
        y = L.row_y0_px(r)
        row_s, row_f, row_u = [], [], []
        for c in range(L.CELLS_PER_PAGE):
            x = x0 + c * L.CELL_PX
            d = dark[y + k: y + L.CELL_PX - k, x + k: x + L.CELL_PX - k]
            rd = red[y + k: y + L.CELL_PX - k, x + k: x + L.CELL_PX - k]
            s, f, u = _classify(d, rd)
            row_s.append(s)
            if f:
                row_f.append(c)
            if u:
                row_u.append(c)
        # An unsure awake cell between two sleep cells is almost always sleep.
        for c in row_u:
            if row_s[c] == "." and 0 < c < 23 and row_s[c - 1] == "S" and row_s[c + 1] == "S":
                row_s[c] = "S"
        sx = L.side_col_x0_px(side)
        side_ink.append(_has_writing(dark[y + 4: y + L.CELL_PX - 4, sx + 4: sx + L.SIDE_COL_PX - 4]))
        sleep.append("".join(row_s))
        feeds.append(row_f)
        unsure.append(row_u)

    return Page(side, conf, sleep, feeds, unsure, side_ink, warped, warnings)


def read_photo(data: bytes, side_hint: str | None = None) -> list[Page]:
    bgr = load_image(data)
    quads = find_frames(bgr)
    if not quads:
        raise ReadError("I couldn't find the ruled frame. Lay the notebook flat, fill the "
                        "photo with the page, and make sure the thick border is all in shot.")
    if len(quads) == 2:   # whole spread in one photo: position decides the side
        return [read_page(warp(bgr, quads[0]), force_side="left"),
                read_page(warp(bgr, quads[1]), force_side="right")]
    return [read_page(warp(bgr, quads[0]), side_hint=side_hint)]
