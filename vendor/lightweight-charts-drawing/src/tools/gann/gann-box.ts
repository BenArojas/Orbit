import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry, RectangleGeometry } from '../../core/geometry';
import { GannBoxPaneView } from './gann-box-pane-view';

/**
 * Gann price levels
 */
export const GANN_LEVELS = [0, 0.25, 0.333, 0.5, 0.667, 0.75, 1];

/**
 * GannBox options
 */
export interface GannBoxOptions extends DrawingOptions {
  priceLevels?: number[];
  timeLevels?: number[];
  showDiagonals?: boolean;
  filled?: boolean;
}

/**
 * GannBox - Gann grid/box for price and time analysis.
 *
 * Features:
 * - Two anchor points (corners)
 * - Horizontal price levels
 * - Vertical time levels
 * - Optional diagonal lines
 */
export class GannBox extends Drawing {
  readonly type = 'gann-box';

  protected static readonly REQUIRED_ANCHORS = 2;
  protected static readonly HIT_THRESHOLD = 5;

  private _gannOptions: GannBoxOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<GannBoxOptions> = {}
  ) {
    const { priceLevels, timeLevels, showDiagonals, filled, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._gannOptions = {
      ...this._options,
      priceLevels: priceLevels ?? GANN_LEVELS,
      timeLevels: timeLevels ?? GANN_LEVELS,
      showDiagonals: showDiagonals ?? true,
      filled: filled ?? false,
    };
  }

  get gannOptions(): GannBoxOptions {
    return this._gannOptions;
  }

  setGannOptions(options: Partial<GannBoxOptions>): void {
    this._gannOptions = { ...this._gannOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= GannBox.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new GannBoxPaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);

    if (!p1 || !p2) return [];

    const geometries: Geometry[] = [];
    const priceLevels = this._gannOptions.priceLevels ?? GANN_LEVELS;
    const timeLevels = this._gannOptions.timeLevels ?? GANN_LEVELS;

    const left = Math.min(p1.x, p2.x);
    const right = Math.max(p1.x, p2.x);
    const top = Math.min(p1.y, p2.y);
    const bottom = Math.max(p1.y, p2.y);
    const width = right - left;
    const height = bottom - top;

    // Outer rectangle
    geometries.push({
      type: 'rectangle',
      topLeft: { x: left, y: top },
      width,
      height,
    } as RectangleGeometry);

    // Horizontal lines (price levels)
    for (const level of priceLevels) {
      if (level === 0 || level === 1) continue;
      const y = top + height * level;
      geometries.push({
        type: 'line',
        start: { x: left, y },
        end: { x: right, y },
      } as LineGeometry);
    }

    // Vertical lines (time levels)
    for (const level of timeLevels) {
      if (level === 0 || level === 1) continue;
      const x = left + width * level;
      geometries.push({
        type: 'line',
        start: { x, y: top },
        end: { x, y: bottom },
      } as LineGeometry);
    }

    // Diagonal lines
    if (this._gannOptions.showDiagonals) {
      // Main diagonals
      geometries.push({
        type: 'line',
        start: { x: left, y: top },
        end: { x: right, y: bottom },
      } as LineGeometry);

      geometries.push({
        type: 'line',
        start: { x: left, y: bottom },
        end: { x: right, y: top },
      } as LineGeometry);
    }

    return geometries;
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

    // Check if inside the box
    return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
  }

  clone(newId: string): IDrawing {
    return new GannBox(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._gannOptions }
    );
  }

  static create(
    id: string,
    corner1: Anchor,
    corner2: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<GannBoxOptions>
  ): GannBox {
    return new GannBox(id, [corner1, corner2], style, options);
  }
}
