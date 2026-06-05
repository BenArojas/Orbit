import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, PolygonGeometry } from '../../core/geometry';
import { distanceBetweenPoints } from '../../core/geometry';
import { DoubleCurvePaneView } from './double-curve-pane-view';

/**
 * Double Curve options
 */
export interface DoubleCurveOptions extends DrawingOptions {
  showControlPoints?: boolean;
  curvature?: number;
  resolution?: number;
}

/**
 * DoubleCurve - S-curve with two control points creating an S-shape.
 *
 * Features:
 * - Three anchor points: start, middle (inflection), end
 * - Automatic control point calculation for smooth S-curve
 * - Adjustable curvature
 */
export class DoubleCurve extends Drawing {
  readonly type = 'double-curve';

  protected static readonly REQUIRED_ANCHORS = 3;
  protected static readonly HIT_THRESHOLD = 5;

  private _doubleCurveOptions: DoubleCurveOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<DoubleCurveOptions> = {}
  ) {
    const { showControlPoints, curvature, resolution, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._doubleCurveOptions = {
      ...this._options,
      showControlPoints: showControlPoints ?? false,
      curvature: curvature ?? 0.5,
      resolution: resolution ?? 50,
    };
  }

  get doubleCurveOptions(): DoubleCurveOptions {
    return this._doubleCurveOptions;
  }

  setDoubleCurveOptions(options: Partial<DoubleCurveOptions>): void {
    this._doubleCurveOptions = { ...this._doubleCurveOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= DoubleCurve.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new DoubleCurvePaneView(this)];
  }

  /**
   * Get the three main points
   */
  getMainPoints(viewport: Viewport): { start: Point; middle: Point; end: Point } | null {
    if (!this.isValid()) return null;

    const start = this.anchorToPixel(this._anchors[0], viewport);
    const middle = this.anchorToPixel(this._anchors[1], viewport);
    const end = this.anchorToPixel(this._anchors[2], viewport);

    if (!start || !middle || !end) return null;

    return { start, middle, end };
  }

  /**
   * Calculate bezier control points for the S-curve
   */
  getBezierControlPoints(viewport: Viewport): {
    cp1: Point;
    cp2: Point;
    cp3: Point;
    cp4: Point;
  } | null {
    const mainPts = this.getMainPoints(viewport);
    if (!mainPts) return null;

    const { start, middle, end } = mainPts;
    const curvature = this._doubleCurveOptions.curvature ?? 0.5;

    // Calculate direction vectors
    const dx1 = middle.x - start.x;
    const dx2 = end.x - middle.x;

    // Control points for first curve (start to middle)
    const cp1: Point = {
      x: start.x + dx1 * curvature,
      y: start.y,
    };
    const cp2: Point = {
      x: middle.x - dx1 * curvature,
      y: middle.y,
    };

    // Control points for second curve (middle to end)
    const cp3: Point = {
      x: middle.x + dx2 * curvature,
      y: middle.y,
    };
    const cp4: Point = {
      x: end.x - dx2 * curvature,
      y: end.y,
    };

    return { cp1, cp2, cp3, cp4 };
  }

  /**
   * Get points along the S-curve
   */
  getCurvePoints(viewport: Viewport): Point[] | null {
    const mainPts = this.getMainPoints(viewport);
    const ctrlPts = this.getBezierControlPoints(viewport);
    if (!mainPts || !ctrlPts) return null;

    const { start, middle, end } = mainPts;
    const { cp1, cp2, cp3, cp4 } = ctrlPts;

    const resolution = this._doubleCurveOptions.resolution ?? 50;
    const halfRes = Math.floor(resolution / 2);
    const points: Point[] = [];

    // First curve: start to middle
    for (let i = 0; i <= halfRes; i++) {
      const t = i / halfRes;
      points.push(this.cubicBezier(start, cp1, cp2, middle, t));
    }

    // Second curve: middle to end
    for (let i = 1; i <= halfRes; i++) {
      const t = i / halfRes;
      points.push(this.cubicBezier(middle, cp3, cp4, end, t));
    }

    return points;
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
      if (dist <= DoubleCurve.HIT_THRESHOLD) {
        return true;
      }
    }

    // Check main anchor points
    const mainPts = this.getMainPoints(viewport);
    if (mainPts) {
      if (distanceBetweenPoints(point, mainPts.start) <= DoubleCurve.HIT_THRESHOLD * 2) return true;
      if (distanceBetweenPoints(point, mainPts.middle) <= DoubleCurve.HIT_THRESHOLD * 2) return true;
      if (distanceBetweenPoints(point, mainPts.end) <= DoubleCurve.HIT_THRESHOLD * 2) return true;
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
    return new DoubleCurve(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._doubleCurveOptions }
    );
  }

  static create(
    id: string,
    start: Anchor,
    middle: Anchor,
    end: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<DoubleCurveOptions>
  ): DoubleCurve {
    return new DoubleCurve(id, [start, middle, end], style, options);
  }
}
