import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry } from '../../core/geometry';
import { EllipsePaneView } from './ellipse-pane-view';

/**
 * Ellipse options
 */
export interface EllipseOptions extends DrawingOptions {
  filled?: boolean;
}

/**
 * Ellipse - An elliptical shape defined by two corner points of bounding box.
 *
 * Features:
 * - Two anchor points (opposite corners of bounding rectangle)
 * - Optional fill
 * - Axis-aligned ellipse
 */
export class Ellipse extends Drawing {
  readonly type = 'ellipse';

  protected static readonly REQUIRED_ANCHORS = 2;
  protected static readonly HIT_THRESHOLD = 5;

  private _ellipseOptions: EllipseOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<EllipseOptions> = {}
  ) {
    const { filled, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._ellipseOptions = {
      ...this._options,
      filled: filled ?? true,
    };
  }

  get ellipseOptions(): EllipseOptions {
    return this._ellipseOptions;
  }

  setEllipseOptions(options: Partial<EllipseOptions>): void {
    this._ellipseOptions = { ...this._ellipseOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= Ellipse.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new EllipsePaneView(this)];
  }

  /**
   * Get ellipse parameters
   */
  getEllipseParams(viewport: Viewport): {
    center: Point;
    radiusX: number;
    radiusY: number;
  } | null {
    if (!this.isValid()) return null;

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);

    if (!p1 || !p2) return null;

    const center: Point = {
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2,
    };

    const radiusX = Math.abs(p2.x - p1.x) / 2;
    const radiusY = Math.abs(p2.y - p1.y) / 2;

    return { center, radiusX, radiusY };
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    const params = this.getEllipseParams(viewport);
    if (!params) return [];

    // Return an arc geometry representing full ellipse
    return [{
      type: 'arc',
      center: params.center,
      radius: Math.max(params.radiusX, params.radiusY),
      startAngle: 0,
      endAngle: Math.PI * 2,
    }];
  }

  testHit(point: Point, viewport: Viewport): boolean {
    const params = this.getEllipseParams(viewport);
    if (!params) return false;

    const { center, radiusX, radiusY } = params;

    if (radiusX === 0 || radiusY === 0) return false;

    // Check if point is inside or near the ellipse
    // Ellipse equation: (x-cx)^2/rx^2 + (y-cy)^2/ry^2 = 1
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const normalizedDist = (dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY);

    if (this._ellipseOptions.filled) {
      return normalizedDist <= 1;
    }

    // Check if near the border
    const innerThreshold = (radiusX - Ellipse.HIT_THRESHOLD) / radiusX;
    const outerThreshold = (radiusX + Ellipse.HIT_THRESHOLD) / radiusX;

    return normalizedDist >= innerThreshold * innerThreshold && normalizedDist <= outerThreshold * outerThreshold;
  }

  clone(newId: string): IDrawing {
    return new Ellipse(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._ellipseOptions }
    );
  }

  static create(
    id: string,
    corner1: Anchor,
    corner2: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<EllipseOptions>
  ): Ellipse {
    return new Ellipse(id, [corner1, corner2], style, options);
  }
}
