import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { FibRetracementPaneView } from './fib-retracement-pane-view';

/**
 * Standard Fibonacci ratios
 */
export const FIBONACCI_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618];

/**
 * FibRetracement options
 */
export interface FibRetracementOptions extends DrawingOptions {
  levels?: number[];
  showPrices?: boolean;
  showPercentages?: boolean;
  extendLines?: boolean;
  reverseDirection?: boolean;
}

/**
 * FibRetracement - Fibonacci retracement levels between two price points.
 *
 * Features:
 * - Two anchor points (high and low)
 * - Multiple Fibonacci level lines
 * - Optional price and percentage labels
 * - Optional line extensions
 * - Customizable levels
 */
export class FibRetracement extends Drawing {
  readonly type = 'fib-retracement';

  protected static readonly REQUIRED_ANCHORS = 2;
  protected static readonly HIT_THRESHOLD = 5;

  private _fibOptions: FibRetracementOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<FibRetracementOptions> = {}
  ) {
    const { levels, showPrices, showPercentages, extendLines, reverseDirection, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._fibOptions = {
      ...this._options,
      levels: levels ?? FIBONACCI_LEVELS,
      showPrices: showPrices ?? true,
      showPercentages: showPercentages ?? true,
      extendLines: extendLines ?? false,
      reverseDirection: reverseDirection ?? false,
    };
  }

  get fibOptions(): FibRetracementOptions {
    return this._fibOptions;
  }

  setFibOptions(options: Partial<FibRetracementOptions>): void {
    this._fibOptions = { ...this._fibOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= FibRetracement.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new FibRetracementPaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);

    if (!p1 || !p2) return [];

    const geometries: Geometry[] = [];
    const levels = this._fibOptions.levels ?? FIBONACCI_LEVELS;
    const price1 = this._anchors[0].price;
    const price2 = this._anchors[1].price;
    const priceRange = price2 - price1;

    for (const level of levels) {
      const price = this._fibOptions.reverseDirection
        ? price2 - priceRange * level
        : price1 + priceRange * level;

      const y = viewport.priceScale.priceToCoordinate(price);
      if (y === null) continue;

      geometries.push({
        type: 'line',
        start: { x: this._fibOptions.extendLines ? 0 : Math.min(p1.x, p2.x), y },
        end: { x: this._fibOptions.extendLines ? viewport.width : Math.max(p1.x, p2.x), y },
      } as LineGeometry);
    }

    return geometries;
  }

  /**
   * Calculate price at a specific Fibonacci level
   */
  getPriceAtLevel(level: number): number {
    if (!this.isValid()) return 0;

    const price1 = this._anchors[0].price;
    const price2 = this._anchors[1].price;
    const priceRange = price2 - price1;

    return this._fibOptions.reverseDirection
      ? price2 - priceRange * level
      : price1 + priceRange * level;
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);

    if (!p1 || !p2) return false;

    const levels = this._fibOptions.levels ?? FIBONACCI_LEVELS;
    const price1 = this._anchors[0].price;
    const price2 = this._anchors[1].price;
    const priceRange = price2 - price1;

    const minX = this._fibOptions.extendLines ? 0 : Math.min(p1.x, p2.x);
    const maxX = this._fibOptions.extendLines ? viewport.width : Math.max(p1.x, p2.x);

    // Check if near any level line
    for (const level of levels) {
      const price = this._fibOptions.reverseDirection
        ? price2 - priceRange * level
        : price1 + priceRange * level;

      const y = viewport.priceScale.priceToCoordinate(price);
      if (y === null) continue;

      if (point.x >= minX && point.x <= maxX && Math.abs(point.y - y) <= FibRetracement.HIT_THRESHOLD) {
        return true;
      }
    }

    return false;
  }

  clone(newId: string): IDrawing {
    return new FibRetracement(
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
    options?: Partial<FibRetracementOptions>
  ): FibRetracement {
    return new FibRetracement(id, [start, end], style, options);
  }
}
