import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { FibTimeZonePaneView } from './fib-time-zone-pane-view';

/**
 * Fibonacci time zone intervals (0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89...)
 */
export const FIB_TIME_INTERVALS = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];

/**
 * FibTimeZone options
 */
export interface FibTimeZoneOptions extends DrawingOptions {
  intervals?: number[];
  showLabels?: boolean;
  filled?: boolean;
}

/**
 * FibTimeZone - Vertical lines at Fibonacci time intervals.
 *
 * Features:
 * - Two anchor points define the unit interval
 * - Vertical lines at Fibonacci sequence positions
 * - Optional labels showing interval number
 * - Optional fill between zones
 */
export class FibTimeZone extends Drawing {
  readonly type = 'fib-time-zone';

  protected static readonly REQUIRED_ANCHORS = 2;
  protected static readonly HIT_THRESHOLD = 5;

  private _fibOptions: FibTimeZoneOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<FibTimeZoneOptions> = {}
  ) {
    const { intervals, showLabels, filled, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._fibOptions = {
      ...this._options,
      intervals: intervals ?? FIB_TIME_INTERVALS,
      showLabels: showLabels ?? true,
      filled: filled ?? true,
    };
  }

  get fibOptions(): FibTimeZoneOptions {
    return this._fibOptions;
  }

  setFibOptions(options: Partial<FibTimeZoneOptions>): void {
    this._fibOptions = { ...this._fibOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= FibTimeZone.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new FibTimeZonePaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);

    if (!p1 || !p2) return [];

    const geometries: Geometry[] = [];
    const intervals = this._fibOptions.intervals ?? FIB_TIME_INTERVALS;
    const unitWidth = p2.x - p1.x;

    for (const interval of intervals) {
      const x = p1.x + unitWidth * interval;

      geometries.push({
        type: 'line',
        start: { x, y: 0 },
        end: { x, y: viewport.height },
      } as LineGeometry);
    }

    return geometries;
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);

    if (!p1 || !p2) return false;

    const intervals = this._fibOptions.intervals ?? FIB_TIME_INTERVALS;
    const unitWidth = p2.x - p1.x;

    for (const interval of intervals) {
      const x = p1.x + unitWidth * interval;
      if (Math.abs(point.x - x) <= FibTimeZone.HIT_THRESHOLD) {
        return true;
      }
    }

    return false;
  }

  clone(newId: string): IDrawing {
    return new FibTimeZone(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._fibOptions }
    );
  }

  static create(
    id: string,
    start: Anchor,
    end: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<FibTimeZoneOptions>
  ): FibTimeZone {
    return new FibTimeZone(id, [start, end], style, options);
  }
}
