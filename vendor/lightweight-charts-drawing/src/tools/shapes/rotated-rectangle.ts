import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, PolygonGeometry } from '../../core/geometry';
import { distanceToLineSegment } from '../../core/geometry';
import { RotatedRectanglePaneView } from './rotated-rectangle-pane-view';

/**
 * Rotated Rectangle options
 */
export interface RotatedRectangleOptions extends DrawingOptions {
  filled?: boolean;
  showDimensions?: boolean;
}

/**
 * RotatedRectangle - A rectangular shape that can be rotated to any angle.
 *
 * Features:
 * - Three anchor points: first two define one edge, third defines height
 * - Rotation determined by the angle of the first edge
 * - Optional fill
 * - Optional dimension labels
 */
export class RotatedRectangle extends Drawing {
  readonly type = 'rotated-rectangle';

  protected static readonly REQUIRED_ANCHORS = 3;
  protected static readonly HIT_THRESHOLD = 5;

  private _rotatedRectangleOptions: RotatedRectangleOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<RotatedRectangleOptions> = {}
  ) {
    const { filled, showDimensions, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._rotatedRectangleOptions = {
      ...this._options,
      filled: filled ?? true,
      showDimensions: showDimensions ?? false,
    };
  }

  get rotatedRectangleOptions(): RotatedRectangleOptions {
    return this._rotatedRectangleOptions;
  }

  setRotatedRectangleOptions(options: Partial<RotatedRectangleOptions>): void {
    this._rotatedRectangleOptions = { ...this._rotatedRectangleOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= RotatedRectangle.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new RotatedRectanglePaneView(this)];
  }

  /**
   * Get the four corners of the rotated rectangle
   */
  getCorners(viewport: Viewport): Point[] | null {
    if (!this.isValid()) return null;

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);
    const p3 = this.anchorToPixel(this._anchors[2], viewport);

    if (!p1 || !p2 || !p3) return null;

    // First two points define one edge
    // Calculate perpendicular direction
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const edgeLength = Math.sqrt(dx * dx + dy * dy);

    if (edgeLength === 0) return null;

    // Perpendicular unit vector
    const perpX = -dy / edgeLength;
    const perpY = dx / edgeLength;

    // Project p3 onto the perpendicular to get height
    const v3x = p3.x - p1.x;
    const v3y = p3.y - p1.y;
    const height = v3x * perpX + v3y * perpY;

    // Four corners
    const corners: Point[] = [
      p1,
      p2,
      { x: p2.x + perpX * height, y: p2.y + perpY * height },
      { x: p1.x + perpX * height, y: p1.y + perpY * height },
    ];

    return corners;
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    const corners = this.getCorners(viewport);
    if (!corners) return [];

    const polygonGeometry: PolygonGeometry = {
      type: 'polygon',
      points: corners,
      closed: true,
    };

    return [polygonGeometry];
  }

  testHit(point: Point, viewport: Viewport): boolean {
    const corners = this.getCorners(viewport);
    if (!corners) return false;

    // Check if inside the polygon using ray casting
    if (this._rotatedRectangleOptions.filled) {
      return this.pointInPolygon(point, corners);
    }

    // Check if near any edge
    for (let i = 0; i < corners.length; i++) {
      const next = (i + 1) % corners.length;
      const dist = distanceToLineSegment(point, corners[i], corners[next]);
      if (dist <= RotatedRectangle.HIT_THRESHOLD) {
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
    return new RotatedRectangle(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._rotatedRectangleOptions }
    );
  }

  static create(
    id: string,
    p1: Anchor,
    p2: Anchor,
    p3: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<RotatedRectangleOptions>
  ): RotatedRectangle {
    return new RotatedRectangle(id, [p1, p2, p3], style, options);
  }
}
