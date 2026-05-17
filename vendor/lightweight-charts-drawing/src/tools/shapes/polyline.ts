import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, PolygonGeometry } from '../../core/geometry';
import { distanceToLineSegment, distanceBetweenPoints } from '../../core/geometry';
import { PolylinePaneView } from './polyline-pane-view';

/**
 * Polyline options
 */
export interface PolylineOptions extends DrawingOptions {
  showVertices?: boolean;
  vertexRadius?: number;
}

/**
 * Polyline - Multi-point connected line with vertex markers.
 *
 * Features:
 * - Multiple anchor points connected by straight lines
 * - Optional vertex markers at each point
 * - Interactive point adding during creation
 */
export class Polyline extends Drawing {
  readonly type = 'polyline';

  protected static readonly REQUIRED_ANCHORS = 2;
  protected static readonly HIT_THRESHOLD = 5;

  private _polylineOptions: PolylineOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<PolylineOptions> = {}
  ) {
    const { showVertices, vertexRadius, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._polylineOptions = {
      ...this._options,
      showVertices: showVertices ?? true,
      vertexRadius: vertexRadius ?? 4,
    };
  }

  get polylineOptions(): PolylineOptions {
    return this._polylineOptions;
  }

  setPolylineOptions(options: Partial<PolylineOptions>): void {
    this._polylineOptions = { ...this._polylineOptions, ...options };
    this.requestUpdate();
  }

  /**
   * Add a point to the polyline
   */
  addPoint(anchor: Anchor): void {
    this._anchors.push(anchor);
    this.requestUpdate();
  }

  /**
   * Insert a point at a specific index
   */
  insertPoint(index: number, anchor: Anchor): void {
    this._anchors.splice(index, 0, anchor);
    this.requestUpdate();
  }

  /**
   * Remove a point at a specific index
   */
  removePoint(index: number): void {
    if (this._anchors.length > 2) {
      this._anchors.splice(index, 1);
      this.requestUpdate();
    }
  }

  isValid(): boolean {
    return this._anchors.length >= Polyline.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new PolylinePaneView(this)];
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
      closed: false,
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

    // Check if near any vertex
    const vertexRadius = this._polylineOptions.vertexRadius ?? 4;
    for (const p of points) {
      if (distanceBetweenPoints(point, p) <= vertexRadius + Polyline.HIT_THRESHOLD) {
        return true;
      }
    }

    // Check if near any segment
    for (let i = 0; i < points.length - 1; i++) {
      const dist = distanceToLineSegment(point, points[i], points[i + 1]);
      if (dist <= Polyline.HIT_THRESHOLD) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get total length of the polyline
   */
  getTotalLength(viewport: Viewport): number {
    if (!this.isValid()) return 0;

    const points: Point[] = [];
    for (const anchor of this._anchors) {
      const p = this.anchorToPixel(anchor, viewport);
      if (p) points.push(p);
    }

    let totalLength = 0;
    for (let i = 0; i < points.length - 1; i++) {
      totalLength += distanceBetweenPoints(points[i], points[i + 1]);
    }

    return totalLength;
  }

  clone(newId: string): IDrawing {
    return new Polyline(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._polylineOptions }
    );
  }

  static create(
    id: string,
    points: Anchor[],
    style?: Partial<DrawingStyle>,
    options?: Partial<PolylineOptions>
  ): Polyline {
    return new Polyline(id, points, style, options);
  }
}
