import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, RectangleGeometry, LineGeometry } from '../../core/geometry';
import { DatePriceRangePaneView } from './date-price-range-pane-view';

/**
 * DatePriceRange options
 */
export interface DatePriceRangeOptions extends DrawingOptions {
  showPrices?: boolean;
  showPercentage?: boolean;
  showBars?: boolean;
  showDays?: boolean;
  filled?: boolean;
}

/**
 * DatePriceRange - Combined date and price measurement tool.
 *
 * Features:
 * - Two anchor points (diagonal corners)
 * - Shows price change (absolute and percentage)
 * - Shows time change (bars and days)
 * - Rectangular measurement zone
 */
export class DatePriceRange extends Drawing {
  readonly type = 'date-price-range';

  protected static readonly REQUIRED_ANCHORS = 2;
  protected static readonly HIT_THRESHOLD = 5;

  private _measureOptions: DatePriceRangeOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<DatePriceRangeOptions> = {}
  ) {
    const { showPrices, showPercentage, showBars, showDays, filled, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._measureOptions = {
      ...this._options,
      showPrices: showPrices ?? true,
      showPercentage: showPercentage ?? true,
      showBars: showBars ?? true,
      showDays: showDays ?? true,
      filled: filled ?? true,
    };
  }

  get measureOptions(): DatePriceRangeOptions {
    return this._measureOptions;
  }

  setMeasureOptions(options: Partial<DatePriceRangeOptions>): void {
    this._measureOptions = { ...this._measureOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= DatePriceRange.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new DatePriceRangePaneView(this)];
  }

  /**
   * Get measurement info
   */
  getMeasureInfo(): {
    startPrice: number;
    endPrice: number;
    priceChange: number;
    priceChangePercent: number;
    startTime: any;
    endTime: any;
    days: number;
    bars: number;
    isUp: boolean;
  } {
    if (!this.isValid()) {
      return {
        startPrice: 0,
        endPrice: 0,
        priceChange: 0,
        priceChangePercent: 0,
        startTime: null,
        endTime: null,
        days: 0,
        bars: 0,
        isUp: true,
      };
    }

    const startPrice = this._anchors[0].price;
    const endPrice = this._anchors[1].price;
    const priceChange = endPrice - startPrice;
    const priceChangePercent = startPrice !== 0 ? (priceChange / startPrice) * 100 : 0;
    const isUp = priceChange >= 0;

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

    const bars = days;

    return {
      startPrice,
      endPrice,
      priceChange,
      priceChangePercent,
      startTime,
      endTime,
      days,
      bars,
      isUp,
    };
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);

    if (!p1 || !p2) return [];

    const geometries: Geometry[] = [];

    const left = Math.min(p1.x, p2.x);
    const right = Math.max(p1.x, p2.x);
    const top = Math.min(p1.y, p2.y);
    const bottom = Math.max(p1.y, p2.y);
    const width = right - left;
    const height = bottom - top;

    // Rectangle
    geometries.push({
      type: 'rectangle',
      topLeft: { x: left, y: top },
      width,
      height,
    } as RectangleGeometry);

    // Diagonal line
    geometries.push({
      type: 'line',
      start: p1,
      end: p2,
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
    const top = Math.min(p1.y, p2.y);
    const bottom = Math.max(p1.y, p2.y);

    return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
  }

  clone(newId: string): IDrawing {
    return new DatePriceRange(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._measureOptions }
    );
  }

  static create(
    id: string,
    start: Anchor,
    end: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<DatePriceRangeOptions>
  ): DatePriceRange {
    return new DatePriceRange(id, [start, end], style, options);
  }
}
