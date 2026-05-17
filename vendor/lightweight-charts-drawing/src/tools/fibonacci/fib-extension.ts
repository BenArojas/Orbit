import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { FibExtensionPaneView } from './fib-extension-pane-view';

/**
 * Standard Fibonacci extension levels
 */
export const FIB_EXTENSION_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618, 2, 2.618, 3.618, 4.236];

/**
 * FibExtension options
 */
export interface FibExtensionOptions extends DrawingOptions {
  levels?: number[];
  showPrices?: boolean;
  showPercentages?: boolean;
  extendLines?: boolean;
}

/**
 * FibExtension - Fibonacci extension levels based on three points.
 *
 * Features:
 * - Three anchor points (A, B, C - swing high/low/retracement)
 * - Extension levels projected from point C
 * - Optional price and percentage labels
 */
export class FibExtension extends Drawing {
  readonly type = 'fib-extension';

  protected static readonly REQUIRED_ANCHORS = 3;
  protected static readonly HIT_THRESHOLD = 5;

  private _fibOptions: FibExtensionOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<FibExtensionOptions> = {}
  ) {
    const { levels, showPrices, showPercentages, extendLines, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._fibOptions = {
      ...this._options,
      levels: levels ?? FIB_EXTENSION_LEVELS,
      showPrices: showPrices ?? true,
      showPercentages: showPercentages ?? true,
      extendLines: extendLines ?? false,
    };
  }

  get fibOptions(): FibExtensionOptions {
    return this._fibOptions;
  }

  setFibOptions(options: Partial<FibExtensionOptions>): void {
    this._fibOptions = { ...this._fibOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= FibExtension.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new FibExtensionPaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const pA = this.anchorToPixel(this._anchors[0], viewport);
    const pB = this.anchorToPixel(this._anchors[1], viewport);
    const pC = this.anchorToPixel(this._anchors[2], viewport);

    if (!pA || !pB || !pC) return [];

    const geometries: Geometry[] = [];
    const levels = this._fibOptions.levels ?? FIB_EXTENSION_LEVELS;

    // Price range from A to B
    const priceA = this._anchors[0].price;
    const priceB = this._anchors[1].price;
    const priceC = this._anchors[2].price;
    const range = priceB - priceA;

    for (const level of levels) {
      // Extension from C
      const price = priceC + range * level;
      const y = viewport.priceScale.priceToCoordinate(price);
      if (y === null) continue;

      const startX = this._fibOptions.extendLines ? 0 : pC.x;
      const endX = this._fibOptions.extendLines ? viewport.width : viewport.width;

      geometries.push({
        type: 'line',
        start: { x: startX, y },
        end: { x: endX, y },
      } as LineGeometry);
    }

    return geometries;
  }

  /**
   * Get price at a specific extension level
   */
  getPriceAtLevel(level: number): number {
    if (!this.isValid()) return 0;

    const priceA = this._anchors[0].price;
    const priceB = this._anchors[1].price;
    const priceC = this._anchors[2].price;
    const range = priceB - priceA;

    return priceC + range * level;
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const pC = this.anchorToPixel(this._anchors[2], viewport);
    if (!pC) return false;

    const levels = this._fibOptions.levels ?? FIB_EXTENSION_LEVELS;
    const priceA = this._anchors[0].price;
    const priceB = this._anchors[1].price;
    const priceC = this._anchors[2].price;
    const range = priceB - priceA;

    for (const level of levels) {
      const price = priceC + range * level;
      const y = viewport.priceScale.priceToCoordinate(price);
      if (y === null) continue;

      if (Math.abs(point.y - y) <= FibExtension.HIT_THRESHOLD) {
        return true;
      }
    }

    return false;
  }

  clone(newId: string): IDrawing {
    return new FibExtension(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._fibOptions }
    );
  }

  static create(
    id: string,
    pointA: Anchor,
    pointB: Anchor,
    pointC: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<FibExtensionOptions>
  ): FibExtension {
    return new FibExtension(id, [pointA, pointB, pointC], style, options);
  }
}
