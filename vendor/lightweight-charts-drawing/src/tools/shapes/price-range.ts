import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, RectangleGeometry } from '../../core/geometry';
import { PriceRangePaneView } from './price-range-pane-view';

/**
 * PriceRange options
 */
export interface PriceRangeOptions extends DrawingOptions {
  showPrices?: boolean;
  showRange?: boolean;
  showPercentage?: boolean;
}

/**
 * PriceRange - A highlighted price zone between two price levels.
 *
 * Features:
 * - Two anchor points (top and bottom of range)
 * - Shows price range and percentage change
 * - Spans full viewport width
 */
export class PriceRange extends Drawing {
  readonly type = 'price-range';

  protected static readonly REQUIRED_ANCHORS = 2;
  protected static readonly HIT_THRESHOLD = 5;

  private _priceRangeOptions: PriceRangeOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<PriceRangeOptions> = {}
  ) {
    const { showPrices, showRange, showPercentage, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._priceRangeOptions = {
      ...this._options,
      showPrices: showPrices ?? true,
      showRange: showRange ?? true,
      showPercentage: showPercentage ?? true,
    };
  }

  get priceRangeOptions(): PriceRangeOptions {
    return this._priceRangeOptions;
  }

  setPriceRangeOptions(options: Partial<PriceRangeOptions>): void {
    this._priceRangeOptions = { ...this._priceRangeOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= PriceRange.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new PriceRangePaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const y1 = viewport.priceScale.priceToCoordinate(this._anchors[0].price);
    const y2 = viewport.priceScale.priceToCoordinate(this._anchors[1].price);

    if (y1 === null || y2 === null) return [];

    const top = Math.min(y1, y2);
    const height = Math.abs(y2 - y1);

    const geometries: Geometry[] = [];

    // Rectangle spanning viewport width
    const rectGeometry: RectangleGeometry = {
      type: 'rectangle',
      topLeft: { x: 0, y: top },
      width: viewport.width,
      height,
    };
    geometries.push(rectGeometry);

    return geometries;
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const y1 = viewport.priceScale.priceToCoordinate(this._anchors[0].price);
    const y2 = viewport.priceScale.priceToCoordinate(this._anchors[1].price);

    if (y1 === null || y2 === null) return false;

    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);

    return point.y >= top && point.y <= bottom;
  }

  /**
   * Get the price range information
   */
  getRangeInfo(): { min: number; max: number; range: number; percentage: number } {
    if (!this.isValid()) return { min: 0, max: 0, range: 0, percentage: 0 };

    const min = Math.min(this._anchors[0].price, this._anchors[1].price);
    const max = Math.max(this._anchors[0].price, this._anchors[1].price);
    const range = max - min;
    const percentage = min !== 0 ? (range / min) * 100 : 0;

    return { min, max, range, percentage };
  }

  clone(newId: string): IDrawing {
    return new PriceRange(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._priceRangeOptions }
    );
  }

  static create(
    id: string,
    price1: number,
    price2: number,
    time: number | string,
    style?: Partial<DrawingStyle>,
    options?: Partial<PriceRangeOptions>
  ): PriceRange {
    return new PriceRange(
      id,
      [
        { time: time as any, price: price1 },
        { time: time as any, price: price2 },
      ],
      style,
      options
    );
  }
}
