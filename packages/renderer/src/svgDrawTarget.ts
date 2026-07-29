import type { DrawTarget, FillStyle, LineStyle, PixelRect, TextStyle } from "./types";

const esc = (value: string | number): string =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function attrsToString(attrs: Record<string, string | number | undefined>): string {
  return Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}="${esc(v as string | number)}"`)
    .join(" ");
}

function selfClosing(name: string, attrs: Record<string, string | number | undefined>): string {
  return `<${name} ${attrsToString(attrs)}/>`;
}

function tag(name: string, attrs: Record<string, string | number | undefined>, children: string): string {
  return `<${name} ${attrsToString(attrs)}>${children}</${name}>`;
}

/** Build an SVG path 'd' string through pixel-space points - same convention as the current
 * renderer's `buildLinePath`. */
function buildLinePath(points: Array<{ x: number; y: number }>): string {
  if (!points.length) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}

/**
 * The SVG implementation of `DrawTarget`. Builds up markup as a stack of string buffers so
 * `group()` can nest `<g>` elements around whatever a Layer draws inside its callback, without
 * every draw call needing to know its own nesting depth.
 */
export class SvgDrawTarget implements DrawTarget {
  private readonly stack: string[][] = [[]];

  private current(): string[] {
    return this.stack[this.stack.length - 1];
  }

  drawLine(points: Array<{ x: number; y: number }>, style: LineStyle): void {
    if (points.length < 2) return;
    this.current().push(
      selfClosing("path", {
        d: buildLinePath(points),
        fill: "none",
        stroke: style.stroke,
        "stroke-width": style.strokeWidth ?? 1,
        "stroke-dasharray": style.dash,
        opacity: style.opacity,
        "stroke-linecap": style.lineCap,
        "stroke-linejoin": style.lineJoin
      })
    );
  }

  drawArea(pathD: string, style: FillStyle): void {
    if (!pathD) return;
    this.current().push(
      selfClosing("path", {
        d: pathD,
        fill: style.fill,
        opacity: style.opacity,
        stroke: style.stroke ?? "none",
        "stroke-width": style.strokeWidth
      })
    );
  }

  drawRect(rect: PixelRect, style: FillStyle): void {
    this.current().push(
      selfClosing("rect", {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        fill: style.fill,
        opacity: style.opacity,
        stroke: style.stroke,
        "stroke-width": style.strokeWidth,
        rx: style.rx
      })
    );
  }

  drawCircle(cx: number, cy: number, r: number, style: FillStyle): void {
    this.current().push(
      selfClosing("circle", {
        cx,
        cy,
        r,
        fill: style.fill,
        opacity: style.opacity,
        stroke: style.stroke,
        "stroke-width": style.strokeWidth
      })
    );
  }

  drawText(x: number, y: number, text: string, style: TextStyle): void {
    this.current().push(
      tag(
        "text",
        {
          x,
          y,
          "text-anchor": style.textAnchor,
          fill: style.fill,
          "font-size": style.fontSize,
          "font-weight": style.fontWeight,
          opacity: style.opacity,
          transform: style.transform
        },
        esc(text)
      )
    );
  }

  group(attrs: Record<string, string>, fn: () => void): void {
    this.stack.push([]);
    fn();
    const inner = this.stack.pop()!.join("");
    this.current().push(tag("g", attrs, inner));
  }

  /** Serializes everything drawn so far into one markup string - call once, after every Layer
   * has rendered. */
  serialize(): string {
    return this.stack[0].join("");
  }
}
