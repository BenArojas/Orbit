import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, RectangleGeometry } from '../../core/geometry';
import { RectanglePaneView } from './rectangle-pane-view';

/**
 * Rectangle options
 */
export interface RectangleOptions extends DrawingOptions {
  filled?: boolean;
  showDimensions?: boolean;
}

/**
 * Rectangle - A rectangular shape defined by two corner points.
 *
 * Features:
 * - Two anchor points (opposite corners)
 * - Optional fill
 * - Optional dimension labels
 */
export class Rectangle extends Drawing {
  readonly type = 'rectangle';

  protected static readonly REQUIRED_ANCHORS = 2;
  protected static readonly HIT_THRESHOLD = 5;

  private _rectangleOptions: RectangleOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<RectangleOptions> = {}
  ) {
    const { filled, showDimensions, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._rectangleOptions = {
      ...this._options,
      filled: filled ?? true,
      showDimensions: showDimensions ?? false,
    };
  }

  get rectangleOptions(): RectangleOptions {
    return this._rectangleOptions;
  }

  setRectangleOptions(options: Partial<RectangleOptions>): void {
    this._rectangleOptions = { ...this._rectangleOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= Rectangle.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new RectanglePaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);

    if (!p1 || !p2) return [];

    const topLeft: Point = {
      x: Math.min(p1.x, p2.x),
      y: Math.min(p1.y, p2.y),
    };
    const width = Math.abs(p2.x - p1.x);
    const height = Math.abs(p2.y - p1.y);

    const rectGeometry: RectangleGeometry = {
      type: 'rectangle',
      topLeft,
      width,
      height,
    };

    return [rectGeometry];
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);

    if (!p1 || !p2) return false;

    const left = Math.min(p1.x, p2.x);
    const right = Math.max(p1.x, p2.x);
    const top = Math.min(p1.y, p2.y);
    const bottom = Math.max(p1.y, p2.y);

    // Check if inside the rectangle
    if (this._rectangleOptions.filled) {
      return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
    }

    // Check if near the border
    const nearLeft = Math.abs(point.x - left) <= Rectangle.HIT_THRESHOLD && point.y >= top && point.y <= bottom;
    const nearRight = Math.abs(point.x - right) <= Rectangle.HIT_THRESHOLD && point.y >= top && point.y <= bottom;
    const nearTop = Math.abs(point.y - top) <= Rectangle.HIT_THRESHOLD && point.x >= left && point.x <= right;
    const nearBottom = Math.abs(point.y - bottom) <= Rectangle.HIT_THRESHOLD && point.x >= left && point.x <= right;

    return nearLeft || nearRight || nearTop || nearBottom;
  }

  /**
   * Get price range of the rectangle
   */
  getPriceRange(): { min: number; max: number; range: number } {
    if (!this.isValid()) return { min: 0, max: 0, range: 0 };
    const min = Math.min(this._anchors[0].price, this._anchors[1].price);
    const max = Math.max(this._anchors[0].price, this._anchors[1].price);
    return { min, max, range: max - min };
  }

  clone(newId: string): IDrawing {
    return new Rectangle(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._rectangleOptions }
    );
  }

  static create(
    id: string,
    corner1: Anchor,
    corner2: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<RectangleOptions>
  ): Rectangle {
    return new Rectangle(id, [corner1, corner2], style, options);
  }
}
