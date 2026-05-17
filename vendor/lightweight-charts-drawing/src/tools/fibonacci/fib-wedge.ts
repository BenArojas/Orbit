import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { distanceToLineSegment } from '../../core/geometry';
import { FibWedgePaneView } from './fib-wedge-pane-view';

/**
 * Fibonacci wedge levels
 */
export const FIB_WEDGE_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/**
 * FibWedge options
 */
export interface FibWedgeOptions extends DrawingOptions {
  levels?: number[];
  showLabels?: boolean;
  filled?: boolean;
}

/**
 * FibWedge - Wedge pattern with Fibonacci level lines.
 *
 * Features:
 * - Three anchor points (apex and two boundary points)
 * - Lines radiating from apex at Fibonacci angle divisions
 * - Optional labels showing level
 * - Optional fill between lines
 */
export class FibWedge extends Drawing {
  readonly type = 'fib-wedge';

  protected static readonly REQUIRED_ANCHORS = 3;
  protected static readonly HIT_THRESHOLD = 5;

  private _fibOptions: FibWedgeOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<FibWedgeOptions> = {}
  ) {
    const { levels, showLabels, filled, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._fibOptions = {
      ...this._options,
      levels: levels ?? FIB_WEDGE_LEVELS,
      showLabels: showLabels ?? true,
      filled: filled ?? true,
    };
  }

  get fibOptions(): FibWedgeOptions {
    return this._fibOptions;
  }

  setFibOptions(options: Partial<FibWedgeOptions>): void {
    this._fibOptions = { ...this._fibOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= FibWedge.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new FibWedgePaneView(this)];
  }

  /**
   * Get the endpoint for a wedge line at a given level
   */
  getWedgeLineEnd(_apex: Point, p1: Point, p2: Point, level: number): Point {
    // Interpolate between p1 and p2 based on level
    return {
      x: p1.x + (p2.x - p1.x) * level,
      y: p1.y + (p2.y - p1.y) * level,
    };
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const apex = this.anchorToPixel(this._anchors[0], viewport);
    const p1 = this.anchorToPixel(this._anchors[1], viewport);
    const p2 = this.anchorToPixel(this._anchors[2], viewport);

    if (!apex || !p1 || !p2) return [];

    const geometries: Geometry[] = [];
    const levels = this._fibOptions.levels ?? FIB_WEDGE_LEVELS;

    // Add boundary lines
    geometries.push({
      type: 'line',
      start: apex,
      end: p1,
    } as LineGeometry);

    geometries.push({
      type: 'line',
      start: apex,
      end: p2,
    } as LineGeometry);

    // Add intermediate Fibonacci lines
    for (const level of levels) {
      if (level === 0 || level === 1) continue; // Skip boundaries

      const end = this.getWedgeLineEnd(apex, p1, p2, level);
      geometries.push({
        type: 'line',
        start: apex,
        end,
      } as LineGeometry);
    }

    return geometries;
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const apex = this.anchorToPixel(this._anchors[0], viewport);
    const p1 = this.anchorToPixel(this._anchors[1], viewport);
    const p2 = this.anchorToPixel(this._anchors[2], viewport);

    if (!apex || !p1 || !p2) return false;

    // Check boundary lines
    if (distanceToLineSegment(point, apex, p1) <= FibWedge.HIT_THRESHOLD) return true;
    if (distanceToLineSegment(point, apex, p2) <= FibWedge.HIT_THRESHOLD) return true;

    // Check intermediate lines
    const levels = this._fibOptions.levels ?? FIB_WEDGE_LEVELS;
    for (const level of levels) {
      if (level === 0 || level === 1) continue;

      const end = this.getWedgeLineEnd(apex, p1, p2, level);
      if (distanceToLineSegment(point, apex, end) <= FibWedge.HIT_THRESHOLD) return true;
    }

    return false;
  }

  clone(newId: string): IDrawing {
    return new FibWedge(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._fibOptions }
    );
  }

  static create(
    id: string,
    apex: Anchor,
    boundary1: Anchor,
    boundary2: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<FibWedgeOptions>
  ): FibWedge {
    return new FibWedge(id, [apex, boundary1, boundary2], style, options);
  }
}
