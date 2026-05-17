import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { distanceToLineSegment } from '../../core/geometry';
import { FibSpeedFanPaneView } from './fib-speed-fan-pane-view';

/**
 * Fibonacci speed fan ratios
 */
export const FIB_SPEED_RATIOS = [0.25, 0.382, 0.5, 0.618, 0.75, 1, 1.618, 2, 4];

/**
 * FibSpeedFan options
 */
export interface FibSpeedFanOptions extends DrawingOptions {
  ratios?: number[];
  showLabels?: boolean;
  extendLines?: boolean;
  filled?: boolean;
}

/**
 * FibSpeedFan - Speed/Resistance fan lines at Fibonacci ratios.
 *
 * Features:
 * - Two anchor points define the main trend
 * - Fan lines emanating from first point at Fibonacci slope ratios
 * - Optional labels showing ratio
 * - Optional line extensions
 */
export class FibSpeedFan extends Drawing {
  readonly type = 'fib-speed-fan';

  protected static readonly REQUIRED_ANCHORS = 2;
  protected static readonly HIT_THRESHOLD = 5;

  private _fibOptions: FibSpeedFanOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<FibSpeedFanOptions> = {}
  ) {
    const { ratios, showLabels, extendLines, filled, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._fibOptions = {
      ...this._options,
      ratios: ratios ?? FIB_SPEED_RATIOS,
      showLabels: showLabels ?? true,
      extendLines: extendLines ?? true,
      filled: filled ?? true,
    };
  }

  get fibOptions(): FibSpeedFanOptions {
    return this._fibOptions;
  }

  setFibOptions(options: Partial<FibSpeedFanOptions>): void {
    this._fibOptions = { ...this._fibOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= FibSpeedFan.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new FibSpeedFanPaneView(this)];
  }

  /**
   * Calculate fan line endpoint for a given ratio
   */
  getFanLineEnd(p1: Point, p2: Point, ratio: number, viewportWidth: number): Point {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;

    // Adjust slope by ratio
    const adjustedDy = dy * ratio;

    // Extend to viewport edge
    const extendFactor = (viewportWidth - p1.x) / Math.max(1, dx);
    return {
      x: p1.x + dx * extendFactor,
      y: p1.y + adjustedDy * extendFactor,
    };
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);

    if (!p1 || !p2) return [];

    const geometries: Geometry[] = [];
    const ratios = this._fibOptions.ratios ?? FIB_SPEED_RATIOS;

    for (const ratio of ratios) {
      const end = this.getFanLineEnd(p1, p2, ratio, viewport.width);

      geometries.push({
        type: 'line',
        start: p1,
        end,
        extendRight: this._fibOptions.extendLines,
      } as LineGeometry);
    }

    return geometries;
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);

    if (!p1 || !p2) return false;

    const ratios = this._fibOptions.ratios ?? FIB_SPEED_RATIOS;

    for (const ratio of ratios) {
      const end = this.getFanLineEnd(p1, p2, ratio, viewport.width);
      if (distanceToLineSegment(point, p1, end) <= FibSpeedFan.HIT_THRESHOLD) {
        return true;
      }
    }

    return false;
  }

  clone(newId: string): IDrawing {
    return new FibSpeedFan(
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
    options?: Partial<FibSpeedFanOptions>
  ): FibSpeedFan {
    return new FibSpeedFan(id, [start, end], style, options);
  }
}
