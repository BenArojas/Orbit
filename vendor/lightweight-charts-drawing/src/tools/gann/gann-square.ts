import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry, RectangleGeometry } from '../../core/geometry';
import { GannSquarePaneView } from './gann-square-pane-view';

/**
 * Gann square divisions for the "Square of Nine" pattern
 */
export const GANN_SQUARE_DIVISIONS = 8;

/**
 * GannSquare options
 */
export interface GannSquareOptions extends DrawingOptions {
  divisions?: number;
  showDiagonals?: boolean;
  showCardinalCross?: boolean;
  showSpiral?: boolean;
  showLabels?: boolean;
  filled?: boolean;
}

/**
 * GannSquare - Resizable Gann square with "Square of Nine" pattern.
 *
 * Features:
 * - Two anchor points (center and corner)
 * - Concentric squares at regular intervals
 * - Cardinal cross (vertical/horizontal through center)
 * - Ordinal cross (45-degree diagonals)
 * - Optional spiral pattern
 */
export class GannSquare extends Drawing {
  readonly type = 'gann-square';

  protected static readonly REQUIRED_ANCHORS = 2;
  protected static readonly HIT_THRESHOLD = 5;

  private _gannOptions: GannSquareOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<GannSquareOptions> = {}
  ) {
    const { divisions, showDiagonals, showCardinalCross, showSpiral, showLabels, filled, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._gannOptions = {
      ...this._options,
      divisions: divisions ?? GANN_SQUARE_DIVISIONS,
      showDiagonals: showDiagonals ?? true,
      showCardinalCross: showCardinalCross ?? true,
      showSpiral: showSpiral ?? false,
      showLabels: showLabels ?? true,
      filled: filled ?? false,
    };
  }

  get gannOptions(): GannSquareOptions {
    return this._gannOptions;
  }

  setGannOptions(options: Partial<GannSquareOptions>): void {
    this._gannOptions = { ...this._gannOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= GannSquare.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new GannSquarePaneView(this)];
  }

  /**
   * Get the square size from center to corner
   */
  getSquareRadius(viewport: Viewport): number {
    if (!this.isValid()) return 0;

    const center = this.anchorToPixel(this._anchors[0], viewport);
    const corner = this.anchorToPixel(this._anchors[1], viewport);

    if (!center || !corner) return 0;

    // Use the larger of dx or dy to maintain square aspect
    const dx = Math.abs(corner.x - center.x);
    const dy = Math.abs(corner.y - center.y);

    return Math.max(dx, dy);
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const center = this.anchorToPixel(this._anchors[0], viewport);
    if (!center) return [];

    const geometries: Geometry[] = [];
    const radius = this.getSquareRadius(viewport);
    const divisions = this._gannOptions.divisions ?? GANN_SQUARE_DIVISIONS;

    // Outer square
    geometries.push({
      type: 'rectangle',
      topLeft: { x: center.x - radius, y: center.y - radius },
      width: radius * 2,
      height: radius * 2,
    } as RectangleGeometry);

    // Concentric squares
    for (let i = 1; i < divisions; i++) {
      const r = (radius * i) / divisions;
      geometries.push({
        type: 'rectangle',
        topLeft: { x: center.x - r, y: center.y - r },
        width: r * 2,
        height: r * 2,
      } as RectangleGeometry);
    }

    // Cardinal cross (horizontal and vertical through center)
    if (this._gannOptions.showCardinalCross) {
      geometries.push({
        type: 'line',
        start: { x: center.x - radius, y: center.y },
        end: { x: center.x + radius, y: center.y },
      } as LineGeometry);

      geometries.push({
        type: 'line',
        start: { x: center.x, y: center.y - radius },
        end: { x: center.x, y: center.y + radius },
      } as LineGeometry);
    }

    // Ordinal cross (diagonals)
    if (this._gannOptions.showDiagonals) {
      geometries.push({
        type: 'line',
        start: { x: center.x - radius, y: center.y - radius },
        end: { x: center.x + radius, y: center.y + radius },
      } as LineGeometry);

      geometries.push({
        type: 'line',
        start: { x: center.x - radius, y: center.y + radius },
        end: { x: center.x + radius, y: center.y - radius },
      } as LineGeometry);
    }

    return geometries;
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const center = this.anchorToPixel(this._anchors[0], viewport);
    if (!center) return false;

    const radius = this.getSquareRadius(viewport);

    // Check if inside the square
    return (
      point.x >= center.x - radius &&
      point.x <= center.x + radius &&
      point.y >= center.y - radius &&
      point.y <= center.y + radius
    );
  }

  clone(newId: string): IDrawing {
    return new GannSquare(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._gannOptions }
    );
  }

  static create(
    id: string,
    center: Anchor,
    corner: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<GannSquareOptions>
  ): GannSquare {
    return new GannSquare(id, [center, corner], style, options);
  }
}
