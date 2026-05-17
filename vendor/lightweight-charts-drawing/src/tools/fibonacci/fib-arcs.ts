import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, ArcGeometry } from '../../core/geometry';
import { distanceBetweenPoints } from '../../core/geometry';
import { FibArcsPaneView } from './fib-arcs-pane-view';

/**
 * Fibonacci arc levels
 */
export const FIB_ARC_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786, 1];

/**
 * FibArcs options
 */
export interface FibArcsOptions extends DrawingOptions {
  levels?: number[];
  showLabels?: boolean;
  fullCircle?: boolean;
}

/**
 * FibArcs - Speed/Resistance arcs at Fibonacci ratios.
 *
 * Features:
 * - Two anchor points (pivot and extent)
 * - Semi-circular or full arcs at Fibonacci distances
 * - Optional labels showing level
 * - Can show half or full circles
 */
export class FibArcs extends Drawing {
  readonly type = 'fib-arcs';

  protected static readonly REQUIRED_ANCHORS = 2;
  protected static readonly HIT_THRESHOLD = 5;

  private _fibOptions: FibArcsOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<FibArcsOptions> = {}
  ) {
    const { levels, showLabels, fullCircle, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._fibOptions = {
      ...this._options,
      levels: levels ?? FIB_ARC_LEVELS,
      showLabels: showLabels ?? true,
      fullCircle: fullCircle ?? false,
    };
  }

  get fibOptions(): FibArcsOptions {
    return this._fibOptions;
  }

  setFibOptions(options: Partial<FibArcsOptions>): void {
    this._fibOptions = { ...this._fibOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= FibArcs.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new FibArcsPaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);

    if (!p1 || !p2) return [];

    const geometries: Geometry[] = [];
    const levels = this._fibOptions.levels ?? FIB_ARC_LEVELS;
    const baseRadius = distanceBetweenPoints(p1, p2);

    // Calculate arc direction based on anchor positions
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const startAngle = this._fibOptions.fullCircle ? 0 : angle - Math.PI / 2;
    const endAngle = this._fibOptions.fullCircle ? Math.PI * 2 : angle + Math.PI / 2;

    for (const level of levels) {
      const radius = baseRadius * level;

      geometries.push({
        type: 'arc',
        center: p1,
        radius,
        startAngle,
        endAngle,
      } as ArcGeometry);
    }

    return geometries;
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);

    if (!p1 || !p2) return false;

    const levels = this._fibOptions.levels ?? FIB_ARC_LEVELS;
    const baseRadius = distanceBetweenPoints(p1, p2);
    const distFromCenter = distanceBetweenPoints(point, p1);

    for (const level of levels) {
      const radius = baseRadius * level;
      if (Math.abs(distFromCenter - radius) <= FibArcs.HIT_THRESHOLD) {
        return true;
      }
    }

    return false;
  }

  clone(newId: string): IDrawing {
    return new FibArcs(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._fibOptions }
    );
  }

  static create(
    id: string,
    pivot: Anchor,
    extent: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<FibArcsOptions>
  ): FibArcs {
    return new FibArcs(id, [pivot, extent], style, options);
  }
}
