import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, PolygonGeometry } from '../../core/geometry';
import { distanceBetweenPoints } from '../../core/geometry';
import { CurvePaneView } from './curve-pane-view';

/**
 * Curve options
 */
export interface CurveOptions extends DrawingOptions {
  showControlLines?: boolean;
  resolution?: number;
}

/**
 * Curve - Cubic Bezier curve with two endpoints and two control points.
 *
 * Features:
 * - Four anchor points: start, control1, control2, end
 * - Smooth curve using cubic bezier interpolation
 * - Optional control line visualization
 */
export class Curve extends Drawing {
  readonly type = 'curve';

  protected static readonly REQUIRED_ANCHORS = 4;
  protected static readonly HIT_THRESHOLD = 5;

  private _curveOptions: CurveOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<CurveOptions> = {}
  ) {
    const { showControlLines, resolution, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._curveOptions = {
      ...this._options,
      showControlLines: showControlLines ?? true,
      resolution: resolution ?? 50,
    };
  }

  get curveOptions(): CurveOptions {
    return this._curveOptions;
  }

  setCurveOptions(options: Partial<CurveOptions>): void {
    this._curveOptions = { ...this._curveOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= Curve.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new CurvePaneView(this)];
  }

  /**
   * Get points along the bezier curve
   */
  getCurvePoints(viewport: Viewport): Point[] | null {
    if (!this.isValid()) return null;

    const p0 = this.anchorToPixel(this._anchors[0], viewport);
    const p1 = this.anchorToPixel(this._anchors[1], viewport);
    const p2 = this.anchorToPixel(this._anchors[2], viewport);
    const p3 = this.anchorToPixel(this._anchors[3], viewport);

    if (!p0 || !p1 || !p2 || !p3) return null;

    const resolution = this._curveOptions.resolution ?? 50;
    const points: Point[] = [];

    for (let i = 0; i <= resolution; i++) {
      const t = i / resolution;
      points.push(this.cubicBezier(p0, p1, p2, p3, t));
    }

    return points;
  }

  /**
   * Get the control points for visualization
   */
  getControlPointsPixels(viewport: Viewport): { start: Point; control1: Point; control2: Point; end: Point } | null {
    if (!this.isValid()) return null;

    const start = this.anchorToPixel(this._anchors[0], viewport);
    const control1 = this.anchorToPixel(this._anchors[1], viewport);
    const control2 = this.anchorToPixel(this._anchors[2], viewport);
    const end = this.anchorToPixel(this._anchors[3], viewport);

    if (!start || !control1 || !control2 || !end) return null;

    return { start, control1, control2, end };
  }

  private cubicBezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
    const t2 = t * t;
    const t3 = t2 * t;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;

    return {
      x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
      y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y,
    };
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    const curvePoints = this.getCurvePoints(viewport);
    if (!curvePoints || curvePoints.length < 2) return [];

    const polygonGeometry: PolygonGeometry = {
      type: 'polygon',
      points: curvePoints,
      closed: false,
    };

    return [polygonGeometry];
  }

  testHit(point: Point, viewport: Viewport): boolean {
    const curvePoints = this.getCurvePoints(viewport);
    if (!curvePoints || curvePoints.length < 2) return false;

    // Check distance to curve segments
    for (let i = 0; i < curvePoints.length - 1; i++) {
      const p1 = curvePoints[i];
      const p2 = curvePoints[i + 1];
      const dist = this.distanceToSegment(point, p1, p2);
      if (dist <= Curve.HIT_THRESHOLD) {
        return true;
      }
    }

    // Check control points
    const controlPts = this.getControlPointsPixels(viewport);
    if (controlPts) {
      if (distanceBetweenPoints(point, controlPts.start) <= Curve.HIT_THRESHOLD * 2) return true;
      if (distanceBetweenPoints(point, controlPts.control1) <= Curve.HIT_THRESHOLD * 2) return true;
      if (distanceBetweenPoints(point, controlPts.control2) <= Curve.HIT_THRESHOLD * 2) return true;
      if (distanceBetweenPoints(point, controlPts.end) <= Curve.HIT_THRESHOLD * 2) return true;
    }

    return false;
  }

  private distanceToSegment(point: Point, p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lengthSq = dx * dx + dy * dy;

    if (lengthSq === 0) {
      return distanceBetweenPoints(point, p1);
    }

    let t = ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));

    const projection: Point = {
      x: p1.x + t * dx,
      y: p1.y + t * dy,
    };

    return distanceBetweenPoints(point, projection);
  }

  clone(newId: string): IDrawing {
    return new Curve(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._curveOptions }
    );
  }

  static create(
    id: string,
    start: Anchor,
    control1: Anchor,
    control2: Anchor,
    end: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<CurveOptions>
  ): Curve {
    return new Curve(id, [start, control1, control2, end], style, options);
  }
}
