import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { distanceToLineSegment } from '../../core/geometry';
import { ForecastPaneView } from './forecast-pane-view';

/**
 * Forecast options
 */
export interface ForecastOptions extends DrawingOptions {
  showPrices?: boolean;
  showPercentage?: boolean;
  showLabels?: boolean;
  filled?: boolean;
}

/**
 * Forecast - Price forecast projection tool.
 *
 * Features:
 * - Two anchor points defining a price range and time range
 * - Anchor 1: start price/time
 * - Anchor 2: target forecast price/time
 * - Shows projected zone with target price/percentage labels
 */
export class Forecast extends Drawing {
  readonly type = 'forecast';

  protected static readonly REQUIRED_ANCHORS = 2;
  protected static readonly HIT_THRESHOLD = 5;

  private _forecastOptions: ForecastOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<ForecastOptions> = {}
  ) {
    const { showPrices, showPercentage, showLabels, filled, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._forecastOptions = {
      ...this._options,
      showPrices: showPrices ?? true,
      showPercentage: showPercentage ?? true,
      showLabels: showLabels ?? true,
      filled: filled ?? true,
    };
  }

  get forecastOptions(): ForecastOptions {
    return this._forecastOptions;
  }

  setForecastOptions(options: Partial<ForecastOptions>): void {
    this._forecastOptions = { ...this._forecastOptions, ...options };
    this.requestUpdate();
  }

  getForecastInfo(): {
    startPrice: number;
    targetPrice: number;
    priceChange: number;
    percentChange: number;
    isUp: boolean;
  } {
    if (!this.isValid()) {
      return { startPrice: 0, targetPrice: 0, priceChange: 0, percentChange: 0, isUp: true };
    }

    const startPrice = this._anchors[0].price;
    const targetPrice = this._anchors[1].price;
    const priceChange = targetPrice - startPrice;
    const percentChange = startPrice !== 0 ? (priceChange / startPrice) * 100 : 0;
    const isUp = priceChange >= 0;

    return { startPrice, targetPrice, priceChange, percentChange, isUp };
  }

  isValid(): boolean {
    return this._anchors.length >= Forecast.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new ForecastPaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p0 = this.anchorToPixel(this._anchors[0], viewport);
    const p1 = this.anchorToPixel(this._anchors[1], viewport);

    if (!p0 || !p1) return [];

    const geometries: Geometry[] = [];

    // Main forecast line
    geometries.push({
      type: 'line',
      start: p0,
      end: p1,
    } as LineGeometry);

    // Horizontal reference from start
    geometries.push({
      type: 'line',
      start: p0,
      end: { x: p1.x, y: p0.y },
    } as LineGeometry);

    // Vertical target line
    geometries.push({
      type: 'line',
      start: { x: p1.x, y: p0.y },
      end: p1,
    } as LineGeometry);

    return geometries;
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const p0 = this.anchorToPixel(this._anchors[0], viewport);
    const p1 = this.anchorToPixel(this._anchors[1], viewport);

    if (!p0 || !p1) return false;

    // Check diagonal line
    if (distanceToLineSegment(point, p0, p1) <= Forecast.HIT_THRESHOLD) return true;

    // Check horizontal line
    const pH: Point = { x: p1.x, y: p0.y };
    if (distanceToLineSegment(point, p0, pH) <= Forecast.HIT_THRESHOLD) return true;

    // Check vertical line
    if (distanceToLineSegment(point, pH, p1) <= Forecast.HIT_THRESHOLD) return true;

    // Check if inside the filled zone
    if (this._forecastOptions.filled) {
      const left = Math.min(p0.x, p1.x);
      const right = Math.max(p0.x, p1.x);
      const top = Math.min(p0.y, p1.y);
      const bottom = Math.max(p0.y, p1.y);
      if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) return true;
    }

    return false;
  }

  clone(newId: string): IDrawing {
    return new Forecast(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._forecastOptions }
    );
  }

  static create(
    id: string,
    startAnchor: Anchor,
    targetAnchor: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<ForecastOptions>
  ): Forecast {
    return new Forecast(id, [startAnchor, targetAnchor], style, options);
  }
}
