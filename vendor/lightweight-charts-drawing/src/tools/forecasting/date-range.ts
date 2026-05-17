import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, RectangleGeometry, LineGeometry } from '../../core/geometry';
import { DateRangePaneView } from './date-range-pane-view';

/**
 * DateRange options
 */
export interface DateRangeOptions extends DrawingOptions {
  showBars?: boolean;
  showDays?: boolean;
  showDates?: boolean;
  filled?: boolean;
}

/**
 * DateRange - Time measurement tool.
 *
 * Features:
 * - Two anchor points for start and end time
 * - Shows number of bars between points
 * - Shows number of calendar days
 * - Highlighted time zone
 */
export class DateRange extends Drawing {
  readonly type = 'date-range';

  protected static readonly REQUIRED_ANCHORS = 2;
  protected static readonly HIT_THRESHOLD = 5;

  private _dateRangeOptions: DateRangeOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<DateRangeOptions> = {}
  ) {
    const { showBars, showDays, showDates, filled, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._dateRangeOptions = {
      ...this._options,
      showBars: showBars ?? true,
      showDays: showDays ?? true,
      showDates: showDates ?? true,
      filled: filled ?? true,
    };
  }

  get dateRangeOptions(): DateRangeOptions {
    return this._dateRangeOptions;
  }

  setDateRangeOptions(options: Partial<DateRangeOptions>): void {
    this._dateRangeOptions = { ...this._dateRangeOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= DateRange.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new DateRangePaneView(this)];
  }

  /**
   * Get date range info
   */
  getDateRangeInfo(): {
    startTime: any;
    endTime: any;
    days: number;
    bars: number;
  } {
    if (!this.isValid()) {
      return { startTime: null, endTime: null, days: 0, bars: 0 };
    }

    const startTime = this._anchors[0].time;
    const endTime = this._anchors[1].time;

    // Calculate days difference
    let days = 0;
    if (typeof startTime === 'string' && typeof endTime === 'string') {
      const start = new Date(startTime);
      const end = new Date(endTime);
      days = Math.abs(Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    } else if (typeof startTime === 'number' && typeof endTime === 'number') {
      days = Math.abs(Math.floor((endTime - startTime) / (60 * 60 * 24)));
    }

    // Bars count would need to be calculated based on actual data
    // For now, we'll approximate based on trading days (roughly 252 per year)
    const bars = days; // Simplified: 1 bar per day for daily chart

    return { startTime, endTime, days, bars };
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);

    if (!p1 || !p2) return [];

    const geometries: Geometry[] = [];

    const left = Math.min(p1.x, p2.x);
    const width = Math.abs(p2.x - p1.x);

    // Full height rectangle
    geometries.push({
      type: 'rectangle',
      topLeft: { x: left, y: 0 },
      width,
      height: viewport.height,
    } as RectangleGeometry);

    // Vertical lines at start and end
    geometries.push({
      type: 'line',
      start: { x: p1.x, y: 0 },
      end: { x: p1.x, y: viewport.height },
    } as LineGeometry);

    geometries.push({
      type: 'line',
      start: { x: p2.x, y: 0 },
      end: { x: p2.x, y: viewport.height },
    } as LineGeometry);

    return geometries;
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);

    if (!p1 || !p2) return false;

    const left = Math.min(p1.x, p2.x);
    const right = Math.max(p1.x, p2.x);

    return point.x >= left && point.x <= right;
  }

  clone(newId: string): IDrawing {
    return new DateRange(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._dateRangeOptions }
    );
  }

  static create(
    id: string,
    start: Anchor,
    end: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<DateRangeOptions>
  ): DateRange {
    return new DateRange(id, [start, end], style, options);
  }
}
