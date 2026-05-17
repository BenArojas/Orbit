import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, PolygonGeometry } from '../../core/geometry';
import { distanceToLineSegment } from '../../core/geometry';
import { TrianglePaneView } from './triangle-pane-view';

/**
 * Triangle options
 */
export interface TriangleOptions extends DrawingOptions {
  filled?: boolean;
}

/**
 * Triangle - A triangular shape defined by three points.
 *
 * Features:
 * - Three anchor points (vertices)
 * - Optional fill
 */
export class Triangle extends Drawing {
  readonly type = 'triangle';

  protected static readonly REQUIRED_ANCHORS = 3;
  protected static readonly HIT_THRESHOLD = 5;

  private _triangleOptions: TriangleOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<TriangleOptions> = {}
  ) {
    const { filled, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._triangleOptions = {
      ...this._options,
      filled: filled ?? true,
    };
  }

  get triangleOptions(): TriangleOptions {
    return this._triangleOptions;
  }

  setTriangleOptions(options: Partial<TriangleOptions>): void {
    this._triangleOptions = { ...this._triangleOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= Triangle.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new TrianglePaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const points: Point[] = [];
    for (const anchor of this._anchors) {
      const p = this.anchorToPixel(anchor, viewport);
      if (!p) return [];
      points.push(p);
    }

    const polygonGeometry: PolygonGeometry = {
      type: 'polygon',
      points,
      closed: true,
    };

    return [polygonGeometry];
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const points: Point[] = [];
    for (const anchor of this._anchors) {
      const p = this.anchorToPixel(anchor, viewport);
      if (!p) return false;
      points.push(p);
    }

    if (this._triangleOptions.filled) {
      return this.isPointInTriangle(point, points[0], points[1], points[2]);
    }

    // Check if near any edge
    for (let i = 0; i < 3; i++) {
      const next = (i + 1) % 3;
      const dist = distanceToLineSegment(point, points[i], points[next]);
      if (dist <= Triangle.HIT_THRESHOLD) return true;
    }

    return false;
  }

  private isPointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
    const sign = (p1: Point, p2: Point, p3: Point) =>
      (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);

    const d1 = sign(p, a, b);
    const d2 = sign(p, b, c);
    const d3 = sign(p, c, a);

    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;

    return !(hasNeg && hasPos);
  }

  clone(newId: string): IDrawing {
    return new Triangle(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._triangleOptions }
    );
  }

  static create(
    id: string,
    p1: Anchor,
    p2: Anchor,
    p3: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<TriangleOptions>
  ): Triangle {
    return new Triangle(id, [p1, p2, p3], style, options);
  }
}
