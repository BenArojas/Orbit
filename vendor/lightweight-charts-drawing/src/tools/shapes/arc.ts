import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry } from '../../core/geometry';
import { ArcPaneView } from './arc-pane-view';

/**
 * Arc options
 */
export interface ArcOptions extends DrawingOptions {
  filled?: boolean;
}

/**
 * Arc - A circular arc defined by three points.
 *
 * Features:
 * - Three anchor points: center, start point (defines radius and start angle), end point (defines end angle)
 * - Optional fill (pie slice)
 * - Draws the shorter arc between start and end angles
 */
export class Arc extends Drawing {
  readonly type = 'arc';

  protected static readonly REQUIRED_ANCHORS = 3;
  protected static readonly HIT_THRESHOLD = 5;

  private _arcOptions: ArcOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<ArcOptions> = {}
  ) {
    const { filled, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._arcOptions = {
      ...this._options,
      filled: filled ?? false,
    };
  }

  get arcOptions(): ArcOptions {
    return this._arcOptions;
  }

  setArcOptions(options: Partial<ArcOptions>): void {
    this._arcOptions = { ...this._arcOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= Arc.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new ArcPaneView(this)];
  }

  /**
   * Get arc parameters from the three anchor points
   */
  getArcParams(viewport: Viewport): {
    center: Point;
    radius: number;
    startAngle: number;
    endAngle: number;
  } | null {
    if (!this.isValid()) return null;

    const center = this.anchorToPixel(this._anchors[0], viewport);
    const startPoint = this.anchorToPixel(this._anchors[1], viewport);
    const endPoint = this.anchorToPixel(this._anchors[2], viewport);

    if (!center || !startPoint || !endPoint) return null;

    // Calculate radius from center to start point
    const dx = startPoint.x - center.x;
    const dy = startPoint.y - center.y;
    const radius = Math.sqrt(dx * dx + dy * dy);

    if (radius === 0) return null;

    // Calculate angles
    const startAngle = Math.atan2(startPoint.y - center.y, startPoint.x - center.x);
    const endAngle = Math.atan2(endPoint.y - center.y, endPoint.x - center.x);

    return { center, radius, startAngle, endAngle };
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    const params = this.getArcParams(viewport);
    if (!params) return [];

    return [{
      type: 'arc',
      center: params.center,
      radius: params.radius,
      startAngle: params.startAngle,
      endAngle: params.endAngle,
    }];
  }

  testHit(point: Point, viewport: Viewport): boolean {
    const params = this.getArcParams(viewport);
    if (!params) return false;

    const { center, radius, startAngle, endAngle } = params;

    // Check distance from center
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Check if within radius range
    const innerRadius = radius - Arc.HIT_THRESHOLD;
    const outerRadius = radius + Arc.HIT_THRESHOLD;

    if (this._arcOptions.filled) {
      // For filled arc (pie slice), check if within the sector
      if (dist > radius + Arc.HIT_THRESHOLD) return false;
    } else {
      // For unfilled arc, check if near the arc line
      if (dist < innerRadius || dist > outerRadius) return false;
    }

    // Check if angle is within arc range
    let angle = Math.atan2(dy, dx);

    // Normalize angles to [0, 2π]
    let normStart = startAngle;
    let normEnd = endAngle;
    let normAngle = angle;

    while (normStart < 0) normStart += Math.PI * 2;
    while (normEnd < 0) normEnd += Math.PI * 2;
    while (normAngle < 0) normAngle += Math.PI * 2;

    // Check if angle is between start and end (considering wrap-around)
    if (normStart <= normEnd) {
      return normAngle >= normStart && normAngle <= normEnd;
    } else {
      return normAngle >= normStart || normAngle <= normEnd;
    }
  }

  clone(newId: string): IDrawing {
    return new Arc(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._arcOptions }
    );
  }

  static create(
    id: string,
    center: Anchor,
    startPoint: Anchor,
    endPoint: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<ArcOptions>
  ): Arc {
    return new Arc(id, [center, startPoint, endPoint], style, options);
  }
}
