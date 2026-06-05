import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { distanceToLineSegment } from '../../core/geometry';
import { FibChannelPaneView } from './fib-channel-pane-view';

/**
 * Standard Fibonacci channel levels
 */
export const FIB_CHANNEL_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618];

/**
 * FibChannel options
 */
export interface FibChannelOptions extends DrawingOptions {
  levels?: number[];
  showPrices?: boolean;
  showPercentages?: boolean;
  extendLines?: boolean;
  filled?: boolean;
}

/**
 * FibChannel - Fibonacci Channel with parallel trend lines at Fibonacci ratios.
 *
 * Features:
 * - Three anchor points (two for baseline, one for channel width)
 * - Multiple parallel lines at Fibonacci levels
 * - Optional fill between levels
 * - Optional line extensions
 */
export class FibChannel extends Drawing {
  readonly type = 'fib-channel';

  protected static readonly REQUIRED_ANCHORS = 3;
  protected static readonly HIT_THRESHOLD = 5;

  private _fibOptions: FibChannelOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<FibChannelOptions> = {}
  ) {
    const { levels, showPrices, showPercentages, extendLines, filled, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._fibOptions = {
      ...this._options,
      levels: levels ?? FIB_CHANNEL_LEVELS,
      showPrices: showPrices ?? true,
      showPercentages: showPercentages ?? true,
      extendLines: extendLines ?? false,
      filled: filled ?? true,
    };
  }

  get fibOptions(): FibChannelOptions {
    return this._fibOptions;
  }

  setFibOptions(options: Partial<FibChannelOptions>): void {
    this._fibOptions = { ...this._fibOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= FibChannel.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new FibChannelPaneView(this)];
  }

  /**
   * Calculate the perpendicular offset from baseline to p3
   */
  calculateOffset(p1: Point, p2: Point, p3: Point): Point {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len === 0) return { x: 0, y: p3.y - p1.y };

    const nx = -dy / len;
    const ny = dx / len;

    const vx = p3.x - p1.x;
    const vy = p3.y - p1.y;

    const dist = vx * nx + vy * ny;

    return { x: nx * dist, y: ny * dist };
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);
    const p3 = this.anchorToPixel(this._anchors[2], viewport);

    if (!p1 || !p2 || !p3) return [];

    const geometries: Geometry[] = [];
    const levels = this._fibOptions.levels ?? FIB_CHANNEL_LEVELS;
    const offset = this.calculateOffset(p1, p2, p3);

    for (const level of levels) {
      const offsetX = offset.x * level;
      const offsetY = offset.y * level;

      const start = { x: p1.x + offsetX, y: p1.y + offsetY };
      const end = { x: p2.x + offsetX, y: p2.y + offsetY };

      geometries.push({
        type: 'line',
        start,
        end,
        extendLeft: this._fibOptions.extendLines,
        extendRight: this._fibOptions.extendLines,
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

    const levels = this._fibOptions.levels ?? FIB_CHANNEL_LEVELS;
    const offset = this.calculateOffset(p1, p2, p3);

    for (const level of levels) {
      const offsetX = offset.x * level;
      const offsetY = offset.y * level;

      const start = { x: p1.x + offsetX, y: p1.y + offsetY };
      const end = { x: p2.x + offsetX, y: p2.y + offsetY };

      if (distanceToLineSegment(point, start, end) <= FibChannel.HIT_THRESHOLD) {
        return true;
      }
    }

    return false;
  }

  clone(newId: string): IDrawing {
    return new FibChannel(
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
    width: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<FibChannelOptions>
  ): FibChannel {
    return new FibChannel(id, [start, end, width], style, options);
  }
}
