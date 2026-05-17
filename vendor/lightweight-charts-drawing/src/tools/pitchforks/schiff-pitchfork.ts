import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { distanceToLineSegment, midpoint } from '../../core/geometry';
import { SchiffPitchforkPaneView } from './schiff-pitchfork-pane-view';

/**
 * SchiffPitchfork options
 */
export interface SchiffPitchforkOptions extends DrawingOptions {
  showMedianLine?: boolean;
  showOuterLines?: boolean;
  extendLines?: boolean;
  filled?: boolean;
}

/**
 * SchiffPitchfork - Schiff Pitchfork variant.
 *
 * The Schiff Pitchfork differs from Andrews' Pitchfork in that the median line
 * starts from the midpoint between the pivot (p0) and the first swing point (p1),
 * rather than from the pivot itself. This creates a less steep median line.
 *
 * Features:
 * - Three anchor points (pivot, and two swing points)
 * - Median line from midpoint(p0,p1) through midpoint of swings
 * - Parallel outer lines through swing points
 * - Optional fill between lines
 */
export class SchiffPitchfork extends Drawing {
  readonly type = 'schiff-pitchfork';

  protected static readonly REQUIRED_ANCHORS = 3;
  protected static readonly HIT_THRESHOLD = 5;

  private _pitchforkOptions: SchiffPitchforkOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<SchiffPitchforkOptions> = {}
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

  get pitchforkOptions(): SchiffPitchforkOptions {
    return this._pitchforkOptions;
  }

  setPitchforkOptions(options: Partial<SchiffPitchforkOptions>): void {
    this._pitchforkOptions = { ...this._pitchforkOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= SchiffPitchfork.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new SchiffPitchforkPaneView(this)];
  }

  /**
   * Calculate the Schiff pivot point (midpoint between p0 and p1)
   */
  getSchiffPivot(p0: Point, p1: Point): Point {
    return midpoint(p0, p1);
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p0 = this.anchorToPixel(this._anchors[0], viewport); // Pivot
    const p1 = this.anchorToPixel(this._anchors[1], viewport); // Swing 1
    const p2 = this.anchorToPixel(this._anchors[2], viewport); // Swing 2

    if (!p0 || !p1 || !p2) return [];

    const geometries: Geometry[] = [];

    // Schiff pivot: midpoint between p0 and p1
    const schiffPivot = this.getSchiffPivot(p0, p1);

    // Midpoint of p1 and p2
    const mid = midpoint(p1, p2);

    // Median line: from schiffPivot through mid
    if (this._pitchforkOptions.showMedianLine) {
      geometries.push({
        type: 'line',
        start: schiffPivot,
        end: mid,
        extendRight: this._pitchforkOptions.extendLines,
      } as LineGeometry);
    }

    // Calculate direction vector for median line
    const dx = mid.x - schiffPivot.x;
    const dy = mid.y - schiffPivot.y;

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

    const schiffPivot = this.getSchiffPivot(p0, p1);
    const mid = midpoint(p1, p2);

    // Check median line
    if (distanceToLineSegment(point, schiffPivot, mid) <= SchiffPitchfork.HIT_THRESHOLD) return true;

    // Check outer lines
    const dx = mid.x - schiffPivot.x;
    const dy = mid.y - schiffPivot.y;

    const p1End = { x: p1.x + dx * 2, y: p1.y + dy * 2 };
    const p2End = { x: p2.x + dx * 2, y: p2.y + dy * 2 };

    if (distanceToLineSegment(point, p1, p1End) <= SchiffPitchfork.HIT_THRESHOLD) return true;
    if (distanceToLineSegment(point, p2, p2End) <= SchiffPitchfork.HIT_THRESHOLD) return true;

    return false;
  }

  clone(newId: string): IDrawing {
    return new SchiffPitchfork(
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
    options?: Partial<SchiffPitchforkOptions>
  ): SchiffPitchfork {
    return new SchiffPitchfork(id, [pivot, swing1, swing2], style, options);
  }
}
