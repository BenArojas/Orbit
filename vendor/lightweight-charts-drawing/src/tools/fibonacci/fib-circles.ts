import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, ArcGeometry } from '../../core/geometry';
import { distanceBetweenPoints } from '../../core/geometry';
import { FibCirclesPaneView } from './fib-circles-pane-view';

/**
 * Fibonacci circle levels
 */
export const FIB_CIRCLE_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618];

/**
 * FibCircles options
 */
export interface FibCirclesOptions extends DrawingOptions {
  levels?: number[];
  showLabels?: boolean;
  filled?: boolean;
}

/**
 * FibCircles - Concentric circles at Fibonacci ratios.
 *
 * Features:
 * - Two anchor points (center and radius point)
 * - Concentric circles at Fibonacci ratio distances
 * - Optional labels showing level
 * - Optional fill between circles
 */
export class FibCircles extends Drawing {
  readonly type = 'fib-circles';

  protected static readonly REQUIRED_ANCHORS = 2;
  protected static readonly HIT_THRESHOLD = 5;

  private _fibOptions: FibCirclesOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<FibCirclesOptions> = {}
  ) {
    const { levels, showLabels, filled, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._fibOptions = {
      ...this._options,
      levels: levels ?? FIB_CIRCLE_LEVELS,
      showLabels: showLabels ?? true,
      filled: filled ?? false,
    };
  }

  get fibOptions(): FibCirclesOptions {
    return this._fibOptions;
  }

  setFibOptions(options: Partial<FibCirclesOptions>): void {
    this._fibOptions = { ...this._fibOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= FibCircles.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new FibCirclesPaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p1 = this.anchorToPixel(this._anchors[0], viewport); // Center
    const p2 = this.anchorToPixel(this._anchors[1], viewport); // Radius point

    if (!p1 || !p2) return [];

    const geometries: Geometry[] = [];
    const levels = this._fibOptions.levels ?? FIB_CIRCLE_LEVELS;
    const baseRadius = distanceBetweenPoints(p1, p2);

    for (const level of levels) {
      const radius = baseRadius * level;

      geometries.push({
        type: 'arc',
        center: p1,
        radius,
        startAngle: 0,
        endAngle: Math.PI * 2,
      } as ArcGeometry);
    }

    return geometries;
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);

    if (!p1 || !p2) return false;

    const levels = this._fibOptions.levels ?? FIB_CIRCLE_LEVELS;
    const baseRadius = distanceBetweenPoints(p1, p2);
    const distFromCenter = distanceBetweenPoints(point, p1);

    for (const level of levels) {
      const radius = baseRadius * level;
      if (Math.abs(distFromCenter - radius) <= FibCircles.HIT_THRESHOLD) {
        return true;
      }
    }

    return false;
  }

  clone(newId: string): IDrawing {
    return new FibCircles(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._fibOptions }
    );
  }

  static create(
    id: string,
    center: Anchor,
    radiusPoint: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<FibCirclesOptions>
  ): FibCircles {
    return new FibCircles(id, [center, radiusPoint], style, options);
  }
}
