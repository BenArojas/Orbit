import type { IPrimitivePaneView } from 'lightweight-charts';

import { BaseLine } from './base-line';
import type { Anchor, Point, DrawingStyle, DrawingOptions, IDrawing, Viewport } from '../../core/types';
import type { Geometry, LineGeometry, TextGeometry } from '../../core/geometry';
import { getLineAngleDegrees, midpoint } from '../../core/geometry';
import { TrendLinePaneView } from './trend-line-pane-view';

/**
 * TrendLine options beyond base drawing options
 */
export interface TrendLineOptions extends DrawingOptions {
  showAngle?: boolean;
  showPriceChange?: boolean;
  showPercentChange?: boolean;
  showBars?: boolean;
}

/**
 * TrendLine - The most advanced line drawing tool.
 *
 * Features:
 * - Two-point line drawing
 * - Optional line extensions (left/right)
 * - Optional angle display
 * - Optional price/percentage change display
 * - Optional bar count display
 * - Hit testing for selection
 * - Anchor manipulation
 */
export class TrendLine extends BaseLine {
  readonly type = 'trend-line';

  private _trendLineOptions: TrendLineOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<TrendLineOptions> = {}
  ) {
    const { showAngle, showPriceChange, showPercentChange, showBars, ...baseOptions } = options;

    super(id, anchors, style, baseOptions);

    this._trendLineOptions = {
      ...this._options,
      showAngle: showAngle ?? false,
      showPriceChange: showPriceChange ?? false,
      showPercentChange: showPercentChange ?? false,
      showBars: showBars ?? false,
    };
  }

  // ============ Getters/Setters ============

  get trendLineOptions(): TrendLineOptions {
    return this._trendLineOptions;
  }

  setTrendLineOptions(options: Partial<TrendLineOptions>): void {
    this._trendLineOptions = { ...this._trendLineOptions, ...options };
    this.requestUpdate();
  }

  // ============ Pane Views ============

  paneViews(): IPrimitivePaneView[] {
    return [new TrendLinePaneView(this)];
  }

  // ============ Geometry ============

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const start = this.anchorToPixel(this._anchors[0], viewport);
    const end = this.anchorToPixel(this._anchors[1], viewport);

    if (!start || !end) return [];

    const geometries: Geometry[] = [];

    // Main line
    const lineGeometry: LineGeometry = {
      type: 'line',
      start,
      end,
      extendLeft: this._options.extendLeft,
      extendRight: this._options.extendRight,
    };
    geometries.push(lineGeometry);

    // Add labels if enabled
    if (this._trendLineOptions.showAngle ||
        this._trendLineOptions.showPriceChange ||
        this._trendLineOptions.showPercentChange ||
        this._trendLineOptions.showBars) {
      const labelGeometries = this.computeLabelGeometry(start, end);
      geometries.push(...labelGeometries);
    }

    return geometries;
  }

  private computeLabelGeometry(start: Point, end: Point): Geometry[] {
    const labels: TextGeometry[] = [];
    const labelPosition = midpoint(start, end);
    const offset = 15; // pixels above the line

    // Calculate label text
    const labelParts: string[] = [];

    if (this._trendLineOptions.showAngle) {
      const angle = getLineAngleDegrees(start, end);
      labelParts.push(`${angle.toFixed(1)}°`);
    }

    if (this._trendLineOptions.showPriceChange) {
      const { absolute } = this.getPriceChange();
      const sign = absolute >= 0 ? '+' : '';
      labelParts.push(`${sign}${absolute.toFixed(2)}`);
    }

    if (this._trendLineOptions.showPercentChange) {
      const { percentage } = this.getPriceChange();
      const sign = percentage >= 0 ? '+' : '';
      labelParts.push(`${sign}${percentage.toFixed(2)}%`);
    }

    if (this._trendLineOptions.showBars) {
      const bars = this.getTimeSpan();
      labelParts.push(`${bars} bars`);
    }

    if (labelParts.length > 0) {
      labels.push({
        type: 'text',
        position: { x: labelPosition.x, y: labelPosition.y - offset },
        text: labelParts.join(' | '),
        font: this._style.labelFont,
        color: this._style.labelColor,
        align: 'center',
        baseline: 'bottom',
      });
    }

    return labels;
  }

  // ============ Clone ============

  clone(newId: string): IDrawing {
    return new TrendLine(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._trendLineOptions }
    );
  }

  // ============ Serialization ============

  toJSON() {
    const base = super.toJSON();
    return {
      ...base,
      options: { ...this._trendLineOptions },
    };
  }

  fromJSON(data: any): void {
    super.fromJSON(data);
    if (data.options) {
      this._trendLineOptions = { ...this._trendLineOptions, ...data.options };
    }
  }

  // ============ Static Factory ============

  static create(
    id: string,
    startAnchor: Anchor,
    endAnchor: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<TrendLineOptions>
  ): TrendLine {
    return new TrendLine(id, [startAnchor, endAnchor], style, options);
  }
}
