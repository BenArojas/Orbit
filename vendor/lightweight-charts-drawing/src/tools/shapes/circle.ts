import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, ArcGeometry } from '../../core/geometry';
import { distanceBetweenPoints } from '../../core/geometry';
import { CirclePaneView } from './circle-pane-view';

/**
 * Circle options
 */
export interface CircleOptions extends DrawingOptions {
  filled?: boolean;
}

/**
 * Circle - A circular shape defined by center and edge point.
 *
 * Features:
 * - Two anchor points (center and edge)
 * - Radius determined by distance between points
 * - Optional fill
 */
export class Circle extends Drawing {
  readonly type = 'circle';

  protected static readonly REQUIRED_ANCHORS = 2;
  protected static readonly HIT_THRESHOLD = 5;

  private _circleOptions: CircleOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<CircleOptions> = {}
  ) {
    const { filled, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._circleOptions = {
      ...this._options,
      filled: filled ?? true,
    };
  }

  get circleOptions(): CircleOptions {
    return this._circleOptions;
  }

  setCircleOptions(options: Partial<CircleOptions>): void {
    this._circleOptions = { ...this._circleOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= Circle.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new CirclePaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const center = this.anchorToPixel(this._anchors[0], viewport);
    const edge = this.anchorToPixel(this._anchors[1], viewport);

    if (!center || !edge) return [];

    const radius = distanceBetweenPoints(center, edge);

    const arcGeometry: ArcGeometry = {
      type: 'arc',
      center,
      radius,
      startAngle: 0,
      endAngle: Math.PI * 2,
    };

    return [arcGeometry];
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const center = this.anchorToPixel(this._anchors[0], viewport);
    const edge = this.anchorToPixel(this._anchors[1], viewport);

    if (!center || !edge) return false;

    const radius = distanceBetweenPoints(center, edge);
    const distToCenter = distanceBetweenPoints(point, center);

    if (this._circleOptions.filled) {
      return distToCenter <= radius;
    }

    // Check if near the circumference
    return Math.abs(distToCenter - radius) <= Circle.HIT_THRESHOLD;
  }

  /**
   * Get the radius in pixels (requires viewport)
   */
  getRadius(viewport: Viewport): number {
    if (!this.isValid()) return 0;

    const center = this.anchorToPixel(this._anchors[0], viewport);
    const edge = this.anchorToPixel(this._anchors[1], viewport);

    if (!center || !edge) return 0;

    return distanceBetweenPoints(center, edge);
  }

  clone(newId: string): IDrawing {
    return new Circle(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._circleOptions }
    );
  }

  static create(
    id: string,
    center: Anchor,
    edge: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<CircleOptions>
  ): Circle {
    return new Circle(id, [center, edge], style, options);
  }
}
