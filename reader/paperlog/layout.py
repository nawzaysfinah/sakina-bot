"""Geometry of one A5 spread. Shared by the reader and the stencil generator.

All measurements are in millimetres and follow the notebook's 5 mm grid.

    LEFT PAGE (night)                    RIGHT PAGE (day)
    +-----+------------------------+     +------------------------+-----+
    | hdr | 7  9  11  1  3  5      |     | 7  9  11  1  3  5      | W.D |   <- header row
    +-----+------------------------+     +------------------------+-----+
    |  1  | 24 half-hour cells     |     | 24 half-hour cells     | 5.2 |   <- row 1
    |  2  | 7pm ............ 7am   |     | 7am ............ 7pm   | 6.1 |
    | ... |                        |     |                        |     |
    | 31  |                        |     |                        |     |
    +-----+------------------------+     +------------------------+-----+
     15mm          120mm                          120mm              15mm

Row N is the night leading into day N, then day N itself:
7pm on day N-1  ->  7pm on day N.  Rule of thumb: at 7pm, move down a line.
"""

GRID_MM = 5.0                 # notebook square
CELLS_PER_PAGE = 24           # 12 hours x 2
CELL_MINUTES = 30
ROWS = 31
HEADER_ROWS = 1

SIDE_COL_MM = 15.0            # date column (left) / tally column (right), 3 squares
CELLS_MM = CELLS_PER_PAGE * GRID_MM          # 120
FRAME_W_MM = SIDE_COL_MM + CELLS_MM          # 135
FRAME_H_MM = (HEADER_ROWS + ROWS) * GRID_MM  # 160

DAY_START_HOUR = 19           # each row starts at 7pm the evening before

# Canonical resolution the reader warps each page to.
PX_PER_MM = 10
FRAME_W_PX = int(FRAME_W_MM * PX_PER_MM)     # 1350
FRAME_H_PX = int(FRAME_H_MM * PX_PER_MM)     # 1600
CELL_PX = int(GRID_MM * PX_PER_MM)           # 50
SIDE_COL_PX = int(SIDE_COL_MM * PX_PER_MM)   # 150

# Stencil (acrylic) geometry, per page.
PAGE_W_MM = 148.0
PAGE_H_MM = 210.0
OUTER_MARGIN_MM = 5.0         # page outer edge -> frame
SPINE_MARGIN_MM = PAGE_W_MM - OUTER_MARGIN_MM - FRAME_W_MM   # 8
TOP_MARGIN_MM = 25.0


def cells_x0_px(side: str) -> int:
    """Left edge (px) of the first half-hour cell on a warped page."""
    return SIDE_COL_PX if side == "left" else 0


def side_col_x0_px(side: str) -> int:
    return 0 if side == "left" else int(CELLS_MM * PX_PER_MM)


def row_y0_px(row_index: int) -> int:
    """Top edge (px) of data row `row_index` (0-based)."""
    return (HEADER_ROWS + row_index) * CELL_PX
