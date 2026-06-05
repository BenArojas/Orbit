import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { distanceToLineSegment, midpoint } from '../../core/geometry';
import { InsidePitchforkPaneView } from './inside-pitchfork-pane-view';

/**
 * InsidePitchfork options
 */
export interface InsidePitchforkOptions extends DrawingOptions {
  showMedianLine?: boolean;
  showOuterLines?: boolean;
  extendLines?: boolean;
  filled?: boolean;
}

/**
 * InsidePitchfork - Inside Pitchfork variant.
 *
 * The Inside Pitchfork differs from Andrews' Pitchfork in that the outer
 * lines converge toward the median line rather than running parallel to it.
 * The outer lines start from the swing points (p1, p2) and converge toward
 * a point on the extended median line.
 *
 * Features:
 * - Three anchor points (pivot, and two swing points)
 * - Median line from pivot through midpoint of swings
 * - Converging outer lines from swing points toward median
 * - Optional fill between lines
 */
export class InsidePitchfork extends Drawing {
  readonly type = 'inside-pitchfork';

  protected static readonly REQUIRED_ANCHORS = 3;
  protected static readonly HIT_THRESHOLD = 5;

  private _pitchforkOptions: InsidePitchforkOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<InsidePitchforkOptions> = {}
  ) {
    const { showMedianLine, showOuterLines, extendLines, filled, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._pitchforkOptions = {
      ...this._options,
      showMedianLine: showMedianLine ?? true,
      showOuterLines: showOuterLines ?? true,
      extendLines: extendLines ?? true,
      filled: filled ?? true,
    };
  }

  get pitchforkOptions(): InsidePitchforkOptions {
    return this._pitchforkOptions;
  }

  setPitchforkOptions(options: Partial<InsidePitchforkOptions>): void {
    this._pitchforkOptions = { ...this._pitchforkOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= InsidePitchfork.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new InsidePitchforkPaneView(this)];
  }

  /**
   * Calculate the convergence point on the median line where outer lines meet.
   * This is a point further along the median line.
   */
  getConvergencePoint(p0: Point, mid: Point, factor: number = 3): Point {
    const dx = mid.x - p0.x;
    const dy = mid.y - p0.y;
    return {
      x: p0.x + dx * factor,
      y: p0.y + dy * factor,
    };
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p0 = this.anchorToPixel(this._anchors[0], viewport); // Pivot
    const p1 = this.anchorToPixel(this._anchors[1], viewport); // Swing 1
    const p2 = this.anchorToPixel(this._anchors[2], viewport); // Swing 2

    if (!p0 || !p1 || !p2) return [];

    const geometries: Geometry[] = [];

    // Midpoint of p1 and p2
    const mid = midpoint(p1, p2);

    // Median line: from p0 through mid
    if (this._pitchforkOptions.showMedianLine) {
      geometries.push({
        type: 'line',
        start: p0,
        end: mid,
        extendRight: this._pitchforkOptions.extendLines,
      } as LineGeometry);
    }

    // Convergence point on median line
    const convergencePoint = this.getConvergencePoint(p0, mid, 3);

    // Outer lines converge from p1 and p2 toward convergence point
    if (this._pitchforkOptions.showOuterLines) {
      geometries.push({
        type: 'line',
        start: p1,
        end: convergencePoint,
        extendRight: this._pitchforkOptions.extendLines,
      } as LineGeometry);

      geometries.push({
        type: 'line',
        start: p2,
        end: convergencePoint,
        extendRight: this._pitchforkOptions.extendLines,
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

    const mid = midpoint(p1, p2);
    const convergencePoint = this.getConvergencePoint(p0, mid, 3);

    // Check median line
    if (distanceToLineSegment(point, p0, mid) <= InsidePitchfork.HIT_THRESHOLD) return true;

    // Check converging lines
    if (distanceToLineSegment(point, p1, convergencePoint) <= InsidePitchfork.HIT_THRESHOLD) return true;
    if (distanceToLineSegment(point, p2, convergencePoint) <= InsidePitchfork.HIT_THRESHOLD) return true;

    return false;
  }

  clone(newId: string): IDrawing {
    return new InsidePitchfork(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._pitchforkOptions }
    );
  }

  static create(
    id: string,
    pivot: Anchor,
    swing1: Anchor,
    swing2: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<InsidePitchforkOptions>
  ): InsidePitchfork {
    return new InsidePitchfork(id, [pivot, swing1, swing2], style, options);
  }
}
