import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { distanceToLineSegment, distanceToLine } from '../../core/geometry';
import { DrawingPaneView } from '../../rendering/drawing-pane-view';

/**
 * Base class for two-point line drawings.
 * Provides common functionality for trend lines, rays, arrows, etc.
 */
export abstract class BaseLine extends Drawing {
  protected static readonly HIT_THRESHOLD = 5; // pixels
  protected static readonly REQUIRED_ANCHORS = 2;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<DrawingOptions> = {}
  ) {
    super(id, anchors, style, options);
  }

  // ============ Validation ============

  isValid(): boolean {
    return this._anchors.length >= BaseLine.REQUIRED_ANCHORS;
  }

  // ============ Pane Views ============

  paneViews(): IPrimitivePaneView[] {
    return [new DrawingPaneView(this)];
  }

  // ============ Geometry ============

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const start = this.anchorToPixel(this._anchors[0], viewport);
    const end = this.anchorToPixel(this._anchors[1], viewport);

    if (!start || !end) return [];

    const lineGeometry: LineGeometry = {
      type: 'line',
      start,
      end,
      extendLeft: this._options.extendLeft,
      extendRight: this._options.extendRight,
    };

    return [lineGeometry];
  }

  // ============ Hit Testing ============

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const start = this.anchorToPixel(this._anchors[0], viewport);
    const end = this.anchorToPixel(this._anchors[1], viewport);

    if (!start || !end) return false;

    // Check if line is extended
    const isExtended = this._options.extendLeft || this._options.extendRight;

    let distance: number;
    if (isExtended) {
      // Use infinite line distance
      distance = distanceToLine(point, start, end);
    } else {
      // Use segment distance
      distance = distanceToLineSegment(point, start, end);
    }

    return distance <= BaseLine.HIT_THRESHOLD;
  }

  // ============ Utility Methods ============

  /**
   * Convert a Time value to epoch seconds.
   * Handles numeric timestamps, "YYYY-MM-DD" strings, and BusinessDay objects.
   */
  protected static timeToSeconds(time: any): number {
    if (typeof time === 'number') return time;
    if (typeof time === 'string') return new Date(time).getTime() / 1000;
    if (typeof time === 'object' && time !== null && 'year' in time) {
      return new Date(time.year, time.month - 1, time.day).getTime() / 1000;
    }
    return NaN;
  }

  /**
   * Get the angle of the line in degrees
   */
  getAngle(): number {
    if (!this.isValid()) return 0;

    const dx = this._anchors[1].price - this._anchors[0].price;
    const dt = BaseLine.timeToSeconds(this._anchors[1].time) - BaseLine.timeToSeconds(this._anchors[0].time);

    return Math.atan2(dx, dt) * (180 / Math.PI);
  }

  /**
   * Get the price change between anchors
   */
  getPriceChange(): { absolute: number; percentage: number } {
    if (!this.isValid()) return { absolute: 0, percentage: 0 };

    const startPrice = this._anchors[0].price;
    const endPrice = this._anchors[1].price;
    const absolute = endPrice - startPrice;
    const percentage = startPrice !== 0 ? (absolute / startPrice) * 100 : 0;

    return { absolute, percentage };
  }

  /**
   * Get the time span between anchors in bars (calendar days)
   */
  getTimeSpan(): number {
    if (!this.isValid()) return 0;
    const t0 = BaseLine.timeToSeconds(this._anchors[0].time);
    const t1 = BaseLine.timeToSeconds(this._anchors[1].time);
    return Math.round(Math.abs(t1 - t0) / 86400);
  }
}
