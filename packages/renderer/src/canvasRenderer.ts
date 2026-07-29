import type { Renderer, RenderInput, RenderResult } from "./types";

/**
 * Intentionally unimplemented placeholder for a future non-SVG render target
 * (docs/RENDERER_ARCHITECTURE.md §5/§8/§9). Explicitly out of scope for this migration - the bar
 * for "not a stub" is Axis/Grid/Scatter actually working against a `CanvasRenderingContext2D`,
 * proving `DrawTarget` isn't secretly SVG-shaped; that's deferred until a real second consumer
 * needs Canvas output.
 */
export class CanvasRenderer implements Renderer {
  constructor(private readonly ctx2d: unknown) {}

  render(_input: RenderInput): RenderResult {
    throw new Error("CanvasRenderer: not yet implemented (see ADR-0009 draft in docs/RENDERER_ARCHITECTURE.md §9)");
  }
}
