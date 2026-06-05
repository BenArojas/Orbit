import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { distanceToLineSegment, midpoint } from '../../core/geometry';
import { PitchfanPaneView } from './pitchfan-pane-view';

/**
 * Pitchfan levels (Fibonacci-based)
 */
export const PITCHFAN_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786, 1];

/**
 * Pitchfan options
 */
export interface PitchfanOptions extends DrawingOptions {
  levels?: number[];
  showLabels?: boolean;
  extendLines?: boolean;
  filled?: boolean;
}

/**
 * Pitchfan - Fan lines from a pitchfork-style base at Fibonacci levels.
 *
 * Features:
 * - Three anchor points (pivot and two swing points)
 * - Fan lines radiating from pivot through Fibonacci divisions
 * - Similar to pitchfork but with multiple fan lines
 * - Optional line extensions
 */
export class Pitchfan extends Drawing {
  readonly type = 'pitchfan';

  protected static readonly REQUIRED_ANCHORS = 3;
  protected static readonly HIT_THRESHOLD = 5;

  private _fibOptions: PitchfanOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<PitchfanOptions> = {}
  ) {
    const { levels, showLabels, extendLines, filled, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._fibOptions = {
      ...this._options,
      levels: levels ?? PITCHFAN_LEVELS,
      showLabels: showLabels ?? true,
      extendLines: extendLines ?? true,
      filled: filled ?? true,
    };
  }

  get fibOptions(): PitchfanOptions {
    return this._fibOptions;
  }

  setFibOptions(options: Partial<PitchfanOptions>): void {
    this._fibOptions = { ...this._fibOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= Pitchfan.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new PitchfanPaneView(this)];
  }

  /**
   * Get the fan line endpoint for a given level
   */
  getFanLineEnd(pivot: Point, p1: Point, p2: Point, level: number): Point {
    // Get point on the p1-p2 line at the given level
    const targetPoint = {
      x: p1.x + (p2.x - p1.x) * level,
      y: p1.y + (p2.y - p1.y) * level,
    };

    // Extend from pivot through target point
    const dx = targetPoint.x - pivot.x;
    const dy = targetPoint.y - pivot.y;

    return {
      x: pivot.x + dx * 3,
      y: pivot.y + dy * 3,
    };
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p0 = this.anchorToPixel(this._anchors[0], viewport); // Pivot
    const p1 = this.anchorToPixel(this._anchors[1], viewport); // Swing 1
    const p2 = this.anchorToPixel(this._anchors[2], viewport); // Swing 2

    if (!p0 || !p1 || !p2) return [];

    const geometries: Geometry[] = [];
    const levels = this._fibOptions.levels ?? PITCHFAN_LEVELS;

    // Median line (through midpoint)
    const mid = midpoint(p1, p2);
    const dx = mid.x - p0.x;
    const dy = mid.y - p0.y;
    const medianEnd = { x: p0.x + dx * 3, y: p0.y + dy * 3 };

    geometries.push({
      type: 'line',
      start: p0,
      end: medianEnd,
      extendRight: this._fibOptions.extendLines,
    } as LineGeometry);

    // Fan lines at Fibonacci levels
    for (const level of levels) {
      const end = this.getFanLineEnd(p0, p1, p2, level);

      geometries.push({
        type: 'line',
        start: p0,
        end,
        extendRight: this._fibOptions.extendLines,
      } as LineGeometry);
    }

    return geometries;
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const p0 = this.anchorToPixel(this._anchors[0], viewport);
    const p1 = this.anchorToPixel(this._anchors[1], viewport);
    const p2 = this.anchorToPixel(this._anchors[2], viewport);

    if (!p0 || !p1 || !p2) return false;

    // Check median line
    const mid = midpoint(p1, p2);
    const dx = mid.x - p0.x;
    const dy = mid.y - p0.y;
    const medianEnd = { x: p0.x + dx * 3, y: p0.y + dy * 3 };
    if (distanceToLineSegment(point, p0, medianEnd) <= Pitchfan.HIT_THRESHOLD) return true;

    // Check fan lines
    const levels = this._fibOptions.levels ?? PITCHFAN_LEVELS;
    for (const level of levels) {
      const end = this.getFanLineEnd(p0, p1, p2, level);
      if (distanceToLineSegment(point, p0, end) <= Pitchfan.HIT_THRESHOLD) return true;
    }

    return false;
  }

  clone(newId: string): IDrawing {
    return new Pitchfan(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._fibOptions }
    );
  }

  static create(
    id: string,
    pivot: Anchor,
    swing1: Anchor,
    swing2: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<PitchfanOptions>
  ): Pitchfan {
    return new Pitchfan(id, [pivot, swing1, swing2], style, options);
  }
}
