import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, DrawingStyle, DrawingOptions, IDrawing, Viewport } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { HorizontalRayPaneView } from './horizontal-ray-pane-view';

/**
 * HorizontalRay options
 */
export interface HorizontalRayOptions extends DrawingOptions {
  showPrice?: boolean;
  direction?: 'right' | 'left';
}

/**
 * HorizontalRay - A horizontal ray extending from a single point.
 *
 * Features:
 * - Single anchor point (price level)
 * - Extends horizontally to the right (or left) edge
 * - Optional price label
 * - Useful for support/resistance levels with direction
 */
export class HorizontalRay extends Drawing {
  readonly type = 'horizontal-ray';

  protected static readonly REQUIRED_ANCHORS = 1;
  protected static readonly HIT_THRESHOLD = 5;

  private _horizontalRayOptions: HorizontalRayOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<HorizontalRayOptions> = {}
  ) {
    const { showPrice, direction, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._horizontalRayOptions = {
      ...this._options,
      showPrice: showPrice ?? true,
      direction: direction ?? 'right',
    };
  }

  get horizontalRayOptions(): HorizontalRayOptions {
    return this._horizontalRayOptions;
  }

  setHorizontalRayOptions(options: Partial<HorizontalRayOptions>): void {
    this._horizontalRayOptions = { ...this._horizontalRayOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= HorizontalRay.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new HorizontalRayPaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const anchor = this._anchors[0];
    const x = viewport.timeScale.timeToCoordinate(anchor.time);
    const y = viewport.priceScale.priceToCoordinate(anchor.price);

    if (x === null || y === null) return [];

    const geometries: Geometry[] = [];

    // Horizontal ray
    const lineGeometry: LineGeometry = {
      type: 'line',
      start: { x, y },
      end: {
        x: this._horizontalRayOptions.direction === 'right' ? viewport.width : 0,
        y,
      },
    };
    geometries.push(lineGeometry);

    return geometries;
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const anchor = this._anchors[0];
    const x = viewport.timeScale.timeToCoordinate(anchor.time);
    const y = viewport.priceScale.priceToCoordinate(anchor.price);

    if (x === null || y === null) return false;

    // Check if within vertical threshold
    if (Math.abs(point.y - y) > HorizontalRay.HIT_THRESHOLD) return false;

    // Check if within horizontal range
    if (this._horizontalRayOptions.direction === 'right') {
      return point.x >= x;
    } else {
      return point.x <= x;
    }
  }

  clone(newId: string): IDrawing {
    return new HorizontalRay(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._horizontalRayOptions }
    );
  }

  static create(
    id: string,
    time: number | string,
    price: number,
    style?: Partial<DrawingStyle>,
    options?: Partial<HorizontalRayOptions>
  ): HorizontalRay {
    return new HorizontalRay(id, [{ time: time as any, price }], style, options);
  }
}
