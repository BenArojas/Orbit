import type { IPrimitivePaneView } from 'lightweight-charts';

import { BaseLine } from './base-line';
import type { Anchor, Point, DrawingStyle, DrawingOptions, IDrawing, Viewport } from '../../core/types';
import type { Geometry, LineGeometry, TextGeometry } from '../../core/geometry';
import { getLineAngleDegrees, midpoint, distanceBetweenPoints } from '../../core/geometry';
import { InfoLinePaneView } from './info-line-pane-view';

/**
 * InfoLine options
 */
export interface InfoLineOptions extends DrawingOptions {
  showDistance?: boolean;
  showAngle?: boolean;
  showPriceChange?: boolean;
  showPercentChange?: boolean;
  showBars?: boolean;
  showTime?: boolean;
}

/**
 * InfoLine - A line that displays measurement information.
 *
 * Features:
 * - Two anchor points
 * - Shows distance, angle, price/percent change
 * - Shows bar count and time duration
 * - Comprehensive measurement tool
 */
export class InfoLine extends BaseLine {
  readonly type = 'info-line';

  private _infoLineOptions: InfoLineOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<InfoLineOptions> = {}
  ) {
    const { showDistance, showAngle, showPriceChange, showPercentChange, showBars, showTime, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._infoLineOptions = {
      ...this._options,
      showDistance: showDistance ?? true,
      showAngle: showAngle ?? true,
      showPriceChange: showPriceChange ?? true,
      showPercentChange: showPercentChange ?? true,
      showBars: showBars ?? true,
      showTime: showTime ?? false,
    };
  }

  get infoLineOptions(): InfoLineOptions {
    return this._infoLineOptions;
  }

  setInfoLineOptions(options: Partial<InfoLineOptions>): void {
    this._infoLineOptions = { ...this._infoLineOptions, ...options };
    this.requestUpdate();
  }

  paneViews(): IPrimitivePaneView[] {
    return [new InfoLinePaneView(this)];
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

    // Add info label
    const labelGeometries = this.computeLabelGeometry(start, end);
    geometries.push(...labelGeometries);

    return geometries;
  }

  private computeLabelGeometry(start: Point, end: Point): Geometry[] {
    const labels: TextGeometry[] = [];
    const labelPosition = midpoint(start, end);
    const offset = 20;

    const labelParts: string[] = [];

    if (this._infoLineOptions.showDistance) {
      const distance = distanceBetweenPoints(start, end);
      labelParts.push(`${distance.toFixed(0)}px`);
    }

    if (this._infoLineOptions.showAngle) {
      const angle = getLineAngleDegrees(start, end);
      labelParts.push(`${angle.toFixed(1)}°`);
    }

    if (this._infoLineOptions.showPriceChange) {
      const { absolute } = this.getPriceChange();
      const sign = absolute >= 0 ? '+' : '';
      labelParts.push(`${sign}${absolute.toFixed(2)}`);
    }

    if (this._infoLineOptions.showPercentChange) {
      const { percentage } = this.getPriceChange();
      const sign = percentage >= 0 ? '+' : '';
      labelParts.push(`${sign}${percentage.toFixed(2)}%`);
    }

    if (this._infoLineOptions.showBars) {
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

  /**
   * Get all measurement info as an object
   */
  getMeasurements(viewport: Viewport): {
    distance: number;
    angle: number;
    priceChange: number;
    percentChange: number;
    bars: number;
  } | null {
    if (!this.isValid()) return null;

    const start = this.anchorToPixel(this._anchors[0], viewport);
    const end = this.anchorToPixel(this._anchors[1], viewport);

    if (!start || !end) return null;

    const { absolute, percentage } = this.getPriceChange();

    return {
      distance: distanceBetweenPoints(start, end),
      angle: getLineAngleDegrees(start, end),
      priceChange: absolute,
      percentChange: percentage,
      bars: this.getTimeSpan(),
    };
  }

  clone(newId: string): IDrawing {
    return new InfoLine(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._infoLineOptions }
    );
  }

  static create(
    id: string,
    startAnchor: Anchor,
    endAnchor: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<InfoLineOptions>
  ): InfoLine {
    return new InfoLine(id, [startAnchor, endAnchor], style, options);
  }
}
