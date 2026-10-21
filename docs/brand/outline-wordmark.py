"""Outline a word set in Inter (SIL Open Font License 1.1) into SVG path data, kerned by HarfBuzz,
with optional custom details for the Flowly wordmark.

Usage: python outline-wordmark.py <font.ttf> <text> [tracking] [--fl-join] [--o-dot] [--y-ball] [--y-slant X] [--l-slant]
  --fl-join  extend the F's top arm into the following l, joining the two letters
  --o-dot    put a dot in the o's counter (the mark's in-progress ring)
  --y-ball   end the y's tail in a round ball (the mark's round nodes)
  --y-slant X  cut the end of the y's tail at an angle instead: its lower corner moves left to x = X
             along the tail's lower edge (Inter ends at 133; 60 gives about 52 degrees, 10 about 40)
  --l-slant  cut the top of each free-standing l at an angle rising to the right (the mark's path)
Prints JSON: {"font", "text", "tracking", "details", "d": path data, "bbox": [x0, y0, x1, y1], "stem": width of the "l" stem}.
Units are font units with the baseline at y=0 and y pointing down (SVG orientation);
tracking is added after every glyph but the last, in font units. Added shapes are drawn clockwise
(font orientation, like Inter's outer contours) so they merge under the nonzero fill rule.
Needs fonttools and uharfbuzz (pip install fonttools uharfbuzz). Detail coordinates assume Inter Medium.
"""
import argparse
import json

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

K = 0.5523  # cubic handle length for a quarter circle


def circle(pen, cx, cy, r):
    """Clockwise in font orientation (y up): top, right, bottom, left."""
    pen.moveTo((cx, cy + r))
    pen.curveTo((cx + K * r, cy + r), (cx + r, cy + K * r), (cx + r, cy))
    pen.curveTo((cx + r, cy - K * r), (cx + K * r, cy - r), (cx, cy - r))
    pen.curveTo((cx - K * r, cy - r), (cx - r, cy - K * r), (cx - r, cy))
    pen.curveTo((cx - r, cy + K * r), (cx - K * r, cy + r), (cx, cy + r))
    pen.closePath()


def rect(pen, x0, y0, x1, y1):
    """Clockwise in font orientation: bottom-left, top-left, top-right, bottom-right."""
    pen.moveTo((x0, y0))
    pen.lineTo((x0, y1))
    pen.lineTo((x1, y1))
    pen.lineTo((x1, y0))
    pen.closePath()


def outline(font_path, text, tracking=0, fl_join=False, o_dot=False, y_ball=False, l_slant=False, y_slant=None):
    font = TTFont(font_path)
    glyphs = font.getGlyphSet()
    blob = hb.Blob.from_file_path(font_path)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(hb.Font(hb.Face(blob)), buf, {"kern": True, "liga": False})
    order = font.getGlyphOrder()
    cap = font["OS/2"].sCapHeight

    # Every glyph, placed, as recorded drawing commands in font orientation.
    placed = []
    x = 0
    infos, positions = buf.glyph_infos, buf.glyph_positions
    for i, (info, pos) in enumerate(zip(infos, positions)):
        name = order[info.codepoint]
        rec = RecordingPen()
        glyphs[name].draw(TransformPen(rec, (1, 0, 0, 1, x + pos.x_offset, pos.y_offset)))
        placed.append({"name": name, "x": x + pos.x_offset, "rec": rec})
        x += pos.x_advance + (tracking if i < len(infos) - 1 else 0)

    extra = RecordingPen()
    joined = set()
    for i, g in enumerate(placed):
        nxt = placed[i + 1] if i + 1 < len(placed) else None
        if fl_join and g["name"] == "F" and nxt and nxt["name"] == "l":
            # Inter Medium F: top arm from y 1294 to the cap height, ending at x 1092; l stem from x 148 to 368.
            rect(extra, g["x"] + 1080, 1294, nxt["x"] + 260, cap)
            joined.add(i + 1)
        if o_dot and g["name"] == "o":
            # Centre of the o's counter (x 320-918, y 163-946); about half the stem wide.
            circle(extra, g["x"] + 619, 554.5, 112)
        if y_ball and g["name"] == "y":
            # The tail ends in a cut from (133, -402) to (187, -223); the ball sits on it.
            circle(extra, g["x"] + 205, -322, 104)
    if y_slant is not None:
        for g in placed:
            if g["name"] == "y":
                # Inter's tail ends in a cut from (133, -402) up to (187, -223); the contour starts at its lower corner.
                # Move that corner left along the lower edge (slope from (235, -426) to (133, -402)), so the cut leans.
                nx = g["x"] + y_slant
                ny = -402 + (133 - y_slant) * (24 / 102)
                ops = g["rec"].value
                op0, pts0 = ops[0]
                assert op0 == "moveTo" and round(pts0[0][0] - g["x"]) == 133, "unexpected y outline"
                ops[0] = ("moveTo", ((nx, ny),))
    if l_slant:
        for i, g in enumerate(placed):
            if g["name"] == "l" and i not in joined:
                # Inter's l is one rectangle; drop its top-left corner so the top rises to the right.
                g["rec"].value = [
                    (op, tuple((px, py - 110) if (round(px - g["x"]) == 148 and py == cap) else (px, py) for px, py in pts))
                    for op, pts in g["rec"].value
                ]

    svg = SVGPathPen(glyphs, ntos=lambda v: f"{v:.1f}".rstrip("0").rstrip("."))
    bounds = BoundsPen(glyphs)
    flip = (1, 0, 0, -1, 0, 0)
    for rec in [g["rec"] for g in placed] + [extra]:
        rec.replay(TransformPen(svg, flip))
        rec.replay(TransformPen(bounds, flip))
    stem = BoundsPen(glyphs)
    glyphs["l"].draw(stem)
    details = [k for k, on in (("fl-join", fl_join), ("o-dot", o_dot), ("y-ball", y_ball), ("l-slant", l_slant)) if on]
    if y_slant is not None:
        details.append(f"y-slant {y_slant}")
    return {
        "font": font["name"].getDebugName(4), "text": text, "tracking": tracking, "details": details,
        "d": svg.getCommands(), "bbox": [round(v, 1) for v in bounds.bounds], "stem": round(stem.bounds[2] - stem.bounds[0], 1),
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("font")
    ap.add_argument("text")
    ap.add_argument("tracking", nargs="?", type=int, default=0)
    for flag in ("--fl-join", "--o-dot", "--y-ball", "--l-slant"):
        ap.add_argument(flag, action="store_true")
    ap.add_argument("--y-slant", type=float, default=None)
    a = ap.parse_args()
    print(json.dumps(outline(a.font, a.text, a.tracking, a.fl_join, a.o_dot, a.y_ball, a.l_slant, a.y_slant)))
