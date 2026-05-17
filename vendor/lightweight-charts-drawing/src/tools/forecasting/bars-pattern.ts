import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry, RectangleGeometry } from '../../core/geometry';
import { distanceToLineSegment } from '../../core/geometry';
import { BarsPatternPaneView } from './bars-pattern-pane-view';

/**
 * Bars Pattern options
 */
export interface BarsPatternOptions extends DrawingOptions {
  showLabels?: boolean;
  filled?: boolean;
  patternColor?: string;
}

/**
 * BarsPattern - Pattern projection tool.
 *
 * Features:
 * - Three anchor points: pattern start (A), pattern end (B), projection start (C)
 * - Copies the price pattern from A-B and projects it from C
 * - Shows the projected pattern zone
 */
export class BarsPattern extends Drawing {
  readonly type = 'bars-pattern';

  protected static readonly REQUIRED_ANCHORS = 3;
  protected static readonly HIT_THRESHOLD = 5;

  private _barsPatternOptions: BarsPatternOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<BarsPatternOptions> = {}
  ) {
    const { showLabels, filled, patternColor, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._barsPatternOptions = {
      ...this._options,
      showLabels: showLabels ?? true,
      filled: filled ?? true,
      patternColor: patternColor ?? '#FF9800',
    };
  }

  get barsPatternOptions(): BarsPatternOptions {
    return this._barsPatternOptions;
  }

  setBarsPatternOptions(options: Partial<BarsPatternOptions>): void {
    this._barsPatternOptions = { ...this._barsPatternOptions, ...options };
    this.requestUpdate();
  }

  /**
   * Get pattern info.
   * A = pattern start, B = pattern end, C = projection start.
   * The pattern from A-B is projected starting at C.
   */
  getPatternInfo(): {
    priceRange: number;
    timeSpan: number;
    projectedEndPrice: number;
  } {
    if (!this.isValid()) {
      return { priceRange: 0, timeSpan: 0, projectedEndPrice: 0 };
    }

    const priceA = this._anchors[0].price;
    const priceB = this._anchors[1].price;
    const priceC = this._anchors[2].price;
    const priceRange = Math.abs(priceB - priceA);
    const projectedEndPrice = priceC + (priceB - priceA);

    return { priceRange, timeSpan: 0, projectedEndPrice };
  }

  isValid(): boolean {
    return this._anchors.length >= BarsPattern.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new BarsPatternPaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const pA = this.anchorToPixel(this._anchors[0], viewport);
    const pB = this.anchorToPixel(this._anchors[1], viewport);
    const pC = this.anchorToPixel(this._anchors[2], viewport);

    if (!pA || !pB || !pC) return [];

    const geometries: Geometry[] = [];

    // Source pattern box A-B
    const srcLeft = Math.min(pA.x, pB.x);
    const srcTop = Math.min(pA.y, pB.y);
    geometries.push({
      type: 'rectangle',
      topLeft: { x: srcLeft, y: srcTop },
      width: Math.abs(pB.x - pA.x),
      height: Math.abs(pB.y - pA.y),
    } as RectangleGeometry);

    // Source diagonal
    geometries.push({
      type: 'line',
      start: pA,
      end: pB,
    } as LineGeometry);

    // Projected pattern
    const dx = pB.x - pA.x;
    const dy = pB.y - pA.y;
    const pD: Point = { x: pC.x + dx, y: pC.y + dy };

    // Projected box C-D
    const projLeft = Math.min(pC.x, pD.x);
    const projTop = Math.min(pC.y, pD.y);
    geometries.push({
      type: 'rectangle',
      topLeft: { x: projLeft, y: projTop },
      width: Math.abs(pD.x - pC.x),
      height: Math.abs(pD.y - pC.y),
    } as RectangleGeometry);

    // Projected diagonal
    geometries.push({
      type: 'line',
      start: pC,
      end: pD,
    } as LineGeometry);

    // Connecting lines
    geometries.push({
      type: 'line',
      start: pB,
      end: pC,
    } as LineGeometry);

    return geometries;
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const pA = this.anchorToPixel(this._anchors[0], viewport);
    const pB = this.anchorToPixel(this._anchors[1], viewport);
    const pC = this.anchorToPixel(this._anchors[2], viewport);

    if (!pA || !pB || !pC) return false;

    const dx = pB.x - pA.x;
    const dy = pB.y - pA.y;
    const pD: Point = { x: pC.x + dx, y: pC.y + dy };

    // Check lines
    if (distanceToLineSegment(point, pA, pB) <= BarsPattern.HIT_THRESHOLD) return true;
    if (distanceToLineSegment(point, pC, pD) <= BarsPattern.HIT_THRESHOLD) return true;
    if (distanceToLineSegment(point, pB, pC) <= BarsPattern.HIT_THRESHOLD) return true;

    // Check inside source box
    const srcLeft = Math.min(pA.x, pB.x);
    const srcRight = Math.max(pA.x, pB.x);
    const srcTop = Math.min(pA.y, pB.y);
    const srcBottom = Math.max(pA.y, pB.y);
    if (point.x >= srcLeft && point.x <= srcRight && point.y >= srcTop && point.y <= srcBottom) return true;

    // Check inside projected box
    const projLeft = Math.min(pC.x, pD.x);
    const projRight = Math.max(pC.x, pD.x);
    const projTop = Math.min(pC.y, pD.y);
    const projBottom = Math.max(pC.y, pD.y);
    if (point.x >= projLeft && point.x <= projRight && point.y >= projTop && point.y <= projBottom) return true;

    return false;
  }

  clone(newId: string): IDrawing {
    return new BarsPattern(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._barsPatternOptions }
    );
  }

  static create(
    id: string,
    pointA: Anchor,
    pointB: Anchor,
    pointC: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<BarsPatternOptions>
  ): BarsPattern {
    return new BarsPattern(id, [pointA, pointB, pointC], style, options);
  }
}
