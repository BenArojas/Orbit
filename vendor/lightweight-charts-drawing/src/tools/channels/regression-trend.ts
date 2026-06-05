import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { distanceToLineSegment } from '../../core/geometry';
import { RegressionTrendPaneView } from './regression-trend-pane-view';

/**
 * RegressionTrend options
 */
export interface RegressionTrendOptions extends DrawingOptions {
  filled?: boolean;
  showMiddleLine?: boolean;
  extendLines?: boolean;
  standardDeviations?: number; // Number of standard deviations for channel width
}

/**
 * RegressionTrend - Linear regression channel with standard deviation bands.
 *
 * Features:
 * - Two anchor points define the regression range
 * - Linear regression calculates the best-fit line
 * - Channel width based on standard deviation
 * - Optional fill between lines
 * - Optional line extensions
 */
export class RegressionTrend extends Drawing {
  readonly type = 'regression-trend';

  protected static readonly REQUIRED_ANCHORS = 2;
  protected static readonly HIT_THRESHOLD = 5;

  private _channelOptions: RegressionTrendOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<RegressionTrendOptions> = {}
  ) {
    const { filled, showMiddleLine, extendLines, standardDeviations, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._channelOptions = {
      ...this._options,
      filled: filled ?? true,
      showMiddleLine: showMiddleLine ?? true,
      extendLines: extendLines ?? false,
      standardDeviations: standardDeviations ?? 2,
    };
  }

  get channelOptions(): RegressionTrendOptions {
    return this._channelOptions;
  }

  setChannelOptions(options: Partial<RegressionTrendOptions>): void {
    this._channelOptions = { ...this._channelOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= RegressionTrend.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new RegressionTrendPaneView(this)];
  }

  /**
   * Calculate linear regression parameters
   */
  calculateRegression(p1: Point, p2: Point): { slope: number; intercept: number; stdDev: number } {
    // Simple two-point linear regression
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;

    if (Math.abs(dx) < 0.001) {
      return { slope: 0, intercept: p1.y, stdDev: 20 }; // Default stdDev for vertical lines
    }

    const slope = dy / dx;
    const intercept = p1.y - slope * p1.x;

    // For a two-point line, we simulate a standard deviation based on the line length
    const lineLength = Math.sqrt(dx * dx + dy * dy);
    const stdDev = Math.max(10, lineLength * 0.1); // 10% of line length or minimum 10px

    return { slope, intercept, stdDev };
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);

    if (!p1 || !p2) return [];

    const geometries: Geometry[] = [];
    const { slope, stdDev } = this.calculateRegression(p1, p2);
    const offset = stdDev * (this._channelOptions.standardDeviations ?? 2);

    // Calculate perpendicular offset
    const len = Math.sqrt(1 + slope * slope);
    const nx = -slope / len;
    const ny = 1 / len;
    const offsetX = nx * offset;
    const offsetY = ny * offset;

    // Middle (regression) line
    geometries.push({
      type: 'line',
      start: p1,
      end: p2,
      extendLeft: this._channelOptions.extendLines,
      extendRight: this._channelOptions.extendLines,
    } as LineGeometry);

    // Upper band
    const p1Upper = { x: p1.x + offsetX, y: p1.y + offsetY };
    const p2Upper = { x: p2.x + offsetX, y: p2.y + offsetY };
    geometries.push({
      type: 'line',
      start: p1Upper,
      end: p2Upper,
      extendLeft: this._channelOptions.extendLines,
      extendRight: this._channelOptions.extendLines,
    } as LineGeometry);

    // Lower band
    const p1Lower = { x: p1.x - offsetX, y: p1.y - offsetY };
    const p2Lower = { x: p2.x - offsetX, y: p2.y - offsetY };
    geometries.push({
      type: 'line',
      start: p1Lower,
      end: p2Lower,
      extendLeft: this._channelOptions.extendLines,
      extendRight: this._channelOptions.extendLines,
    } as LineGeometry);

    return geometries;
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);

    if (!p1 || !p2) return false;

    // Check middle line
    if (distanceToLineSegment(point, p1, p2) <= RegressionTrend.HIT_THRESHOLD) return true;

    const { slope, stdDev } = this.calculateRegression(p1, p2);
    const offset = stdDev * (this._channelOptions.standardDeviations ?? 2);

    const len = Math.sqrt(1 + slope * slope);
    const nx = -slope / len;
    const ny = 1 / len;
    const offsetX = nx * offset;
    const offsetY = ny * offset;

    // Check upper band
    const p1Upper = { x: p1.x + offsetX, y: p1.y + offsetY };
    const p2Upper = { x: p2.x + offsetX, y: p2.y + offsetY };
    if (distanceToLineSegment(point, p1Upper, p2Upper) <= RegressionTrend.HIT_THRESHOLD) return true;

    // Check lower band
    const p1Lower = { x: p1.x - offsetX, y: p1.y - offsetY };
    const p2Lower = { x: p2.x - offsetX, y: p2.y - offsetY };
    if (distanceToLineSegment(point, p1Lower, p2Lower) <= RegressionTrend.HIT_THRESHOLD) return true;

    // If filled, check if inside channel
    if (this._channelOptions.filled) {
      const minX = Math.min(p1Upper.x, p2Upper.x, p1Lower.x, p2Lower.x);
      const maxX = Math.max(p1Upper.x, p2Upper.x, p1Lower.x, p2Lower.x);
      const minY = Math.min(p1Upper.y, p2Upper.y, p1Lower.y, p2Lower.y);
      const maxY = Math.max(p1Upper.y, p2Upper.y, p1Lower.y, p2Lower.y);

      if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) {
        return true;
      }
    }

    return false;
  }

  clone(newId: string): IDrawing {
    return new RegressionTrend(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._channelOptions }
    );
  }

  static create(
    id: string,
    start: Anchor,
    end: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<RegressionTrendOptions>
  ): RegressionTrend {
    return new RegressionTrend(id, [start, end], style, options);
  }
}
