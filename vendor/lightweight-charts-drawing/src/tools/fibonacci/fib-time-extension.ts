import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { FibTimeExtensionPaneView } from './fib-time-extension-pane-view';

/**
 * Fibonacci time extension levels
 */
export const FIB_TIME_EXTENSION_LEVELS = [0, 0.382, 0.5, 0.618, 1, 1.618, 2, 2.618, 4.236];

/**
 * FibTimeExtension options
 */
export interface FibTimeExtensionOptions extends DrawingOptions {
  levels?: number[];
  showLabels?: boolean;
  filled?: boolean;
}

/**
 * FibTimeExtension - Trend-Based Fibonacci Time extension.
 *
 * Features:
 * - Three anchor points (start, end of trend, extension point)
 * - Vertical lines at Fibonacci time projections
 * - Optional labels showing level
 * - Optional fill between zones
 */
export class FibTimeExtension extends Drawing {
  readonly type = 'fib-time-extension';

  protected static readonly REQUIRED_ANCHORS = 3;
  protected static readonly HIT_THRESHOLD = 5;

  private _fibOptions: FibTimeExtensionOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<FibTimeExtensionOptions> = {}
  ) {
    const { levels, showLabels, filled, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._fibOptions = {
      ...this._options,
      levels: levels ?? FIB_TIME_EXTENSION_LEVELS,
      showLabels: showLabels ?? true,
      filled: filled ?? true,
    };
  }

  get fibOptions(): FibTimeExtensionOptions {
    return this._fibOptions;
  }

  setFibOptions(options: Partial<FibTimeExtensionOptions>): void {
    this._fibOptions = { ...this._fibOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= FibTimeExtension.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new FibTimeExtensionPaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);
    const p3 = this.anchorToPixel(this._anchors[2], viewport);

    if (!p1 || !p2 || !p3) return [];

    const geometries: Geometry[] = [];
    const levels = this._fibOptions.levels ?? FIB_TIME_EXTENSION_LEVELS;

    // Base time distance (from p1 to p2)
    const baseTimeWidth = p2.x - p1.x;

    for (const level of levels) {
      // Project from p3 using the base time width
      const x = p3.x + baseTimeWidth * level;

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
    const p3 = this.anchorToPixel(this._anchors[2], viewport);

    if (!p1 || !p2 || !p3) return false;

    const levels = this._fibOptions.levels ?? FIB_TIME_EXTENSION_LEVELS;
    const baseTimeWidth = p2.x - p1.x;

    for (const level of levels) {
      const x = p3.x + baseTimeWidth * level;
      if (Math.abs(point.x - x) <= FibTimeExtension.HIT_THRESHOLD) {
        return true;
      }
    }

    return false;
  }

  clone(newId: string): IDrawing {
    return new FibTimeExtension(
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
    extension: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<FibTimeExtensionOptions>
  ): FibTimeExtension {
    return new FibTimeExtension(id, [start, end, extension], style, options);
  }
}
