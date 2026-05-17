import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { distanceToLineSegment, midpoint } from '../../core/geometry';
import { ModifiedSchiffPitchforkPaneView } from './modified-schiff-pitchfork-pane-view';

/**
 * ModifiedSchiffPitchfork options
 */
export interface ModifiedSchiffPitchforkOptions extends DrawingOptions {
  showMedianLine?: boolean;
  showOuterLines?: boolean;
  extendLines?: boolean;
  filled?: boolean;
}

/**
 * ModifiedSchiffPitchfork - Modified Schiff Pitchfork variant.
 *
 * The Modified Schiff Pitchfork differs from the standard Schiff in that
 * the median line starts from the midpoint of a vertical line drawn from
 * the pivot point (p0) down/up to the price level of the first swing point (p1).
 * This creates a more horizontal median line than both Andrews' and Schiff.
 *
 * Features:
 * - Three anchor points (pivot, and two swing points)
 * - Median line from modified pivot through midpoint of swings
 * - Parallel outer lines through swing points
 * - Optional fill between lines
 */
export class ModifiedSchiffPitchfork extends Drawing {
  readonly type = 'modified-schiff-pitchfork';

  protected static readonly REQUIRED_ANCHORS = 3;
  protected static readonly HIT_THRESHOLD = 5;

  private _pitchforkOptions: ModifiedSchiffPitchforkOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<ModifiedSchiffPitchforkOptions> = {}
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

  get pitchforkOptions(): ModifiedSchiffPitchforkOptions {
    return this._pitchforkOptions;
  }

  setPitchforkOptions(options: Partial<ModifiedSchiffPitchforkOptions>): void {
    this._pitchforkOptions = { ...this._pitchforkOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= ModifiedSchiffPitchfork.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new ModifiedSchiffPitchforkPaneView(this)];
  }

  /**
   * Calculate the Modified Schiff pivot point.
   * It's the midpoint between p0 and a point directly below/above p0 at p1's y-level.
   */
  getModifiedSchiffPivot(p0: Point, p1: Point): Point {
    // Point at p0.x but at p1.y level
    const verticalPoint = { x: p0.x, y: p1.y };
    // Midpoint between p0 and this vertical point
    return midpoint(p0, verticalPoint);
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p0 = this.anchorToPixel(this._anchors[0], viewport); // Pivot
    const p1 = this.anchorToPixel(this._anchors[1], viewport); // Swing 1
    const p2 = this.anchorToPixel(this._anchors[2], viewport); // Swing 2

    if (!p0 || !p1 || !p2) return [];

    const geometries: Geometry[] = [];

    // Modified Schiff pivot
    const modifiedPivot = this.getModifiedSchiffPivot(p0, p1);

    // Midpoint of p1 and p2
    const mid = midpoint(p1, p2);

    // Median line: from modifiedPivot through mid
    if (this._pitchforkOptions.showMedianLine) {
      geometries.push({
        type: 'line',
        start: modifiedPivot,
        end: mid,
        extendRight: this._pitchforkOptions.extendLines,
      } as LineGeometry);
    }

    // Calculate direction vector for median line
    const dx = mid.x - modifiedPivot.x;
    const dy = mid.y - modifiedPivot.y;

    // Outer lines parallel to median, through p1 and p2
    if (this._pitchforkOptions.showOuterLines) {
      const p1End = { x: p1.x + dx * 2, y: p1.y + dy * 2 };
      geometries.push({
        type: 'line',
        start: p1,
        end: p1End,
        extendRight: this._pitchforkOptions.extendLines,
      } as LineGeometry);

      const p2End = { x: p2.x + dx * 2, y: p2.y + dy * 2 };
      geometries.push({
        type: 'line',
        start: p2,
        end: p2End,
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

    const modifiedPivot = this.getModifiedSchiffPivot(p0, p1);
    const mid = midpoint(p1, p2);

    // Check median line
    if (distanceToLineSegment(point, modifiedPivot, mid) <= ModifiedSchiffPitchfork.HIT_THRESHOLD) return true;

    // Check outer lines
    const dx = mid.x - modifiedPivot.x;
    const dy = mid.y - modifiedPivot.y;

    const p1End = { x: p1.x + dx * 2, y: p1.y + dy * 2 };
    const p2End = { x: p2.x + dx * 2, y: p2.y + dy * 2 };

    if (distanceToLineSegment(point, p1, p1End) <= ModifiedSchiffPitchfork.HIT_THRESHOLD) return true;
    if (distanceToLineSegment(point, p2, p2End) <= ModifiedSchiffPitchfork.HIT_THRESHOLD) return true;

    return false;
  }

  clone(newId: string): IDrawing {
    return new ModifiedSchiffPitchfork(
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
    options?: Partial<ModifiedSchiffPitchforkOptions>
  ): ModifiedSchiffPitchfork {
    return new ModifiedSchiffPitchfork(id, [pivot, swing1, swing2], style, options);
  }
}
