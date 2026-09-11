"""
Turns a Storyset SVG into a react-native-svg component.

Written because the illustration had to be *inline* SVG rather than a flat PNG:
you cannot animate the inside of a bitmap. The output keeps the file's own
top-level groups as separate elements, which is what lets the screen bring the
scene in piece by piece the way a Lottie would.

Deliberately a generator and not a hand-conversion: the source has 285 elements
and 286 inline style attributes, and hand-editing that is how a stray fill ends
up wrong in a way nobody sees until it ships.
"""
import re, sys, json

SELF = {"rect", "line", "polyline", "circle", "path", "polygon"}
PROP = {
    "fill": "fill", "stroke": "stroke", "opacity": "opacity",
    "stroke-width": "strokeWidth", "stroke-linecap": "strokeLinecap",
    "stroke-linejoin": "strokeLinejoin", "stroke-miterlimit": "strokeMiterlimit",
    "stroke-dasharray": "strokeDasharray", "fill-rule": "fillRule",
    "fill-opacity": "fillOpacity", "stroke-opacity": "strokeOpacity",
}
GEOM = {"x", "y", "width", "height", "x1", "y1", "x2", "y2", "cx", "cy", "r", "d", "points", "transform"}


def style_props(style: str) -> dict:
    out = {}
    for part in style.split(";"):
        if ":" not in part:
            continue
        k, v = part.split(":", 1)
        k, v = k.strip(), v.strip()
        if k in PROP:
            out[PROP[k]] = v
    return out


def attrs_of(raw: str) -> dict:
    out = {}
    for k, v in re.findall(r'([a-zA-Z-]+)="([^"]*)"', raw):
        if k == "style":
            out.update(style_props(v))
        elif k in GEOM:
            out[k] = v
    return out


def render(props: dict) -> str:
    bits = []
    for k, v in props.items():
        # Numbers unquoted so react-native-svg gets numbers, not strings.
        if re.fullmatch(r"-?\d+(\.\d+)?", v):
            bits.append(f"{k}={{{v}}}")
        else:
            bits.append(f'{k}="{v}"')
    return " ".join(bits)


def convert(node: str, depth: int) -> str:
    """Walks the markup, emitting JSX. Groups keep their nesting."""
    out, i, pad = [], 0, "  " * depth
    while i < len(node):
        m = re.compile(r"<([a-zA-Z]+)([^>]*)>").search(node, i)
        if not m:
            break
        tag, raw = m.group(1), m.group(2)
        if tag == "g":
            close = find_close(node, m.end())
            inner = node[m.end():close]
            gp = attrs_of(raw)
            gid = re.search(r'id="freepik--([^-]+)--', raw)
            name = gid.group(1) if gid else None
            open_tag = f"{pad}<G {render(gp)}>".replace("<G >", "<G>")
            out.append(open_tag if not name else f"{pad}{{/* {name} */}}\n{open_tag}")
            out.append(convert(inner, depth + 1))
            out.append(f"{pad}</G>")
            i = node.index(">", close) + 1
        elif tag in SELF:
            el = tag[0].upper() + tag[1:]
            out.append(f"{pad}<{el} {render(attrs_of(raw))} />")
            end = node.find(f"</{tag}>", m.end())
            i = end + len(tag) + 3 if end != -1 else m.end()
        else:
            i = m.end()
    return "\n".join(x for x in out if x)


def find_close(s: str, start: int) -> int:
    depth, i = 1, start
    while depth and i < len(s):
        nxt_open = s.find("<g", i)
        nxt_close = s.find("</g>", i)
        if nxt_close == -1:
            break
        if nxt_open != -1 and nxt_open < nxt_close:
            depth += 1
            i = nxt_open + 2
        else:
            depth -= 1
            if depth == 0:
                return nxt_close
            i = nxt_close + 4
    return len(s)


src = open(sys.argv[1]).read()
body = src[src.index(">", src.index("<svg")) + 1: src.rindex("</svg>")]

# Split into the file's own top-level groups, in order.
groups = []
i = 0
while True:
    m = re.compile(r'<g id="freepik--([^-]+)--[^"]*">').search(body, i)
    if not m:
        break
    close = find_close(body, m.end())
    groups.append((m.group(1), body[m.end():close]))
    i = body.index(">", close) + 1

print(f"groups: {[g[0] for g in groups]}", file=sys.stderr)
out = {name: convert(inner, 3) for name, inner in groups}
json.dump(out, open(sys.argv[2], "w"))
