import type { IPrimitivePaneView } from 'lightweight-charts';

import { BaseLine } from './base-line';
import type { Anchor, Point, DrawingStyle, DrawingOptions, IDrawing, Viewport } from '../../core/types';
import type { Geometry, LineGeometry, ArcGeometry } from '../../core/geometry';
import { getLineAngleDegrees } from '../../core/geometry';
import { TrendAnglePaneView } from './trend-angle-pane-view';

/**
 * TrendAngle options
 */
export interface TrendAngleOptions extends DrawingOptions {
  showArc?: boolean;
  arcRadius?: number;
  showDegrees?: boolean;
}

/**
 * TrendAngle - A line that displays its angle with a visual arc indicator.
 *
 * Features:
 * - Two anchor points
 * - Visual arc showing the angle from horizontal
 * - Degree label display
 * - Useful for measuring trend slopes
 */
export class TrendAngle extends BaseLine {
  readonly type = 'trend-angle';

  private _trendAngleOptions: TrendAngleOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<TrendAngleOptions> = {}
  ) {
    const { showArc, arcRadius, showDegrees, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._trendAngleOptions = {
      ...this._options,
      showArc: showArc ?? true,
      arcRadius: arcRadius ?? 40,
      showDegrees: showDegrees ?? true,
    };
  }

  get trendAngleOptions(): TrendAngleOptions {
    return this._trendAngleOptions;
  }

  setTrendAngleOptions(options: Partial<TrendAngleOptions>): void {
    this._trendAngleOptions = { ...this._trendAngleOptions, ...options };
    this.requestUpdate();
  }

  paneViews(): IPrimitivePaneView[] {
    return [new TrendAnglePaneView(this)];
  }

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
    };
    geometries.push(lineGeometry);

    // Arc showing angle
    if (this._trendAngleOptions.showArc) {
      const angle = this.getAngleRadians(start, end);
      const arcGeometry: ArcGeometry = {
        type: 'arc',
        center: start,
        radius: this._trendAngleOptions.arcRadius ?? 40,
        startAngle: 0,
        endAngle: angle,
      };
      geometries.push(arcGeometry);
    }

    return geometries;
  }

  /**
   * Get the angle in radians (from horizontal)
   */
  private getAngleRadians(start: Point, end: Point): number {
    return Math.atan2(start.y - end.y, end.x - start.x);
  }

  /**
   * Get the angle in degrees
   */
  getAngle(): number {
    if (!this.isValid()) return 0;
    return getLineAngleDegrees(
      { x: 0, y: 0 },
      {
        x: this._anchors[1].price - this._anchors[0].price,
        y: 0,
      }
    );
  }

  clone(newId: string): IDrawing {
    return new TrendAngle(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._trendAngleOptions }
    );
  }

  static create(
    id: string,
    startAnchor: Anchor,
    endAnchor: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<TrendAngleOptions>
  ): TrendAngle {
    return new TrendAngle(id, [startAnchor, endAnchor], style, options);
  }
}
