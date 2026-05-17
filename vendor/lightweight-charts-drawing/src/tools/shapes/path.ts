import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, PolygonGeometry } from '../../core/geometry';
import { distanceToLineSegment } from '../../core/geometry';
import { PathPaneView } from './path-pane-view';

/**
 * Path options
 */
export interface PathOptions extends DrawingOptions {
  closed?: boolean;
  filled?: boolean;
}

/**
 * Path - Freeform path drawing with straight line segments.
 *
 * Features:
 * - Multiple anchor points connected by straight lines
 * - Optional closed path
 * - Optional fill (when closed)
 */
export class Path extends Drawing {
  readonly type = 'path';

  protected static readonly REQUIRED_ANCHORS = 2;
  protected static readonly HIT_THRESHOLD = 5;

  private _pathOptions: PathOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<PathOptions> = {}
  ) {
    const { closed, filled, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._pathOptions = {
      ...this._options,
      closed: closed ?? false,
      filled: filled ?? false,
    };
  }

  get pathOptions(): PathOptions {
    return this._pathOptions;
  }

  setPathOptions(options: Partial<PathOptions>): void {
    this._pathOptions = { ...this._pathOptions, ...options };
    this.requestUpdate();
  }

  /**
   * Add a point to the path
   */
  addPoint(anchor: Anchor): void {
    this._anchors.push(anchor);
    this.requestUpdate();
  }

  /**
   * Close or open the path
   */
  setClosed(closed: boolean): void {
    this._pathOptions.closed = closed;
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= Path.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new PathPaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const points: Point[] = [];
    for (const anchor of this._anchors) {
      const p = this.anchorToPixel(anchor, viewport);
      if (p) points.push(p);
    }

    if (points.length < 2) return [];

    const polygonGeometry: PolygonGeometry = {
      type: 'polygon',
      points,
      closed: this._pathOptions.closed ?? false,
    };

    return [polygonGeometry];
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const points: Point[] = [];
    for (const anchor of this._anchors) {
      const p = this.anchorToPixel(anchor, viewport);
      if (p) points.push(p);
    }

    if (points.length < 2) return false;

    // Check if filled and closed - test point in polygon
    if (this._pathOptions.filled && this._pathOptions.closed) {
      if (this.pointInPolygon(point, points)) {
        return true;
      }
    }

    // Check if near any segment
    const segmentCount = this._pathOptions.closed ? points.length : points.length - 1;
    for (let i = 0; i < segmentCount; i++) {
      const next = (i + 1) % points.length;
      const dist = distanceToLineSegment(point, points[i], points[next]);
      if (dist <= Path.HIT_THRESHOLD) {
        return true;
      }
    }

    return false;
  }

  private pointInPolygon(point: Point, polygon: Point[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;

      if (((yi > point.y) !== (yj > point.y)) &&
          (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  clone(newId: string): IDrawing {
    return new Path(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._pathOptions }
    );
  }

  static create(
    id: string,
    points: Anchor[],
    style?: Partial<DrawingStyle>,
    options?: Partial<PathOptions>
  ): Path {
    return new Path(id, points, style, options);
  }
}
