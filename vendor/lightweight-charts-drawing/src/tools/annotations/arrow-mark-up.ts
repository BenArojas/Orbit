import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry } from '../../core/geometry';
import { ArrowMarkUpPaneView } from './arrow-mark-up-pane-view';

/**
 * Arrow Mark Up options
 */
export interface ArrowMarkUpOptions extends DrawingOptions {
  size?: number;
}

/**
 * Arrow Mark Up - An upward pointing arrow marker (bullish signal).
 *
 * Features:
 * - Single anchor point
 * - Always points up
 * - Typically placed below price bars
 * - Green color by default
 */
export class ArrowMarkUp extends Drawing {
  readonly type = 'arrow-mark-up';

  protected static readonly REQUIRED_ANCHORS = 1;
  protected static readonly HIT_THRESHOLD = 10;

  private _arrowOptions: ArrowMarkUpOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<ArrowMarkUpOptions> = {}
  ) {
    const { size, ...baseOptions } = options;

    // Default to green for bullish
    const defaultStyle: Partial<DrawingStyle> = {
      lineColor: '#26a69a',
      ...style,
    };

    super(id, anchors, defaultStyle, baseOptions);

    this._arrowOptions = {
      ...this._options,
      size: size ?? 16,
    };
  }

  get arrowOptions(): ArrowMarkUpOptions {
    return this._arrowOptions;
  }

  setArrowOptions(options: Partial<ArrowMarkUpOptions>): void {
    this._arrowOptions = { ...this._arrowOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= ArrowMarkUp.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new ArrowMarkUpPaneView(this)];
  }

  /**
   * Get arrow vertices (always points up)
   */
  getArrowVertices(viewport: Viewport): Point[] | null {
    if (!this.isValid()) return null;

    const anchor = this.anchorToPixel(this._anchors[0], viewport);
    if (!anchor) return null;

    const size = this._arrowOptions.size ?? 16;
    const halfBase = size * 0.6;
    const height = size;

    // Upward pointing arrow
    return [
      { x: anchor.x, y: anchor.y - height },           // tip (top)
      { x: anchor.x - halfBase, y: anchor.y },         // bottom left
      { x: anchor.x + halfBase, y: anchor.y },         // bottom right
    ];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    const vertices = this.getArrowVertices(viewport);
    if (!vertices) return [];

    return [{
      type: 'polygon',
      points: vertices,
      closed: true,
    }];
  }

  testHit(point: Point, viewport: Viewport): boolean {
    const vertices = this.getArrowVertices(viewport);
    if (!vertices || vertices.length < 3) return false;

    return this.pointInTriangle(point, vertices[0], vertices[1], vertices[2]);
  }

  private pointInTriangle(p: Point, v1: Point, v2: Point, v3: Point): boolean {
    const sign = (p1: Point, p2: Point, p3: Point): number => {
      return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
    };

    const d1 = sign(p, v1, v2);
    const d2 = sign(p, v2, v3);
    const d3 = sign(p, v3, v1);

    const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);

    return !(hasNeg && hasPos);
  }

  clone(newId: string): IDrawing {
    return new ArrowMarkUp(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._arrowOptions }
    );
  }

  static create(
    id: string,
    position: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<ArrowMarkUpOptions>
  ): ArrowMarkUp {
    return new ArrowMarkUp(id, [position], style, options);
  }
}
