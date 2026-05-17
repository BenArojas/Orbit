import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { CrossLinePaneView } from './cross-line-pane-view';

/**
 * CrossLine options
 */
export interface CrossLineOptions extends DrawingOptions {
  showPrice?: boolean;
  showTime?: boolean;
}

/**
 * CrossLine - A crosshair at a specific point (horizontal + vertical lines).
 *
 * Features:
 * - Single anchor point
 * - Horizontal and vertical lines through the point
 * - Optional price and time labels
 */
export class CrossLine extends Drawing {
  readonly type = 'cross-line';

  protected static readonly REQUIRED_ANCHORS = 1;
  protected static readonly HIT_THRESHOLD = 5;

  private _crossLineOptions: CrossLineOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<CrossLineOptions> = {}
  ) {
    const { showPrice, showTime, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._crossLineOptions = {
      ...this._options,
      showPrice: showPrice ?? true,
      showTime: showTime ?? true,
    };
  }

  get crossLineOptions(): CrossLineOptions {
    return this._crossLineOptions;
  }

  setCrossLineOptions(options: Partial<CrossLineOptions>): void {
    this._crossLineOptions = { ...this._crossLineOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= CrossLine.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new CrossLinePaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const anchor = this._anchors[0];
    const x = viewport.timeScale.timeToCoordinate(anchor.time);
    const y = viewport.priceScale.priceToCoordinate(anchor.price);

    if (x === null || y === null) return [];

    const geometries: Geometry[] = [];

    // Horizontal line
    geometries.push({
      type: 'line',
      start: { x: 0, y },
      end: { x: viewport.width, y },
    } as LineGeometry);

    // Vertical line
    geometries.push({
      type: 'line',
      start: { x, y: 0 },
      end: { x, y: viewport.height },
    } as LineGeometry);

    return geometries;
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const anchor = this._anchors[0];
    const x = viewport.timeScale.timeToCoordinate(anchor.time);
    const y = viewport.priceScale.priceToCoordinate(anchor.price);

    if (x === null || y === null) return false;

    // Hit if near either the horizontal or vertical line
    return Math.abs(point.x - x) <= CrossLine.HIT_THRESHOLD ||
           Math.abs(point.y - y) <= CrossLine.HIT_THRESHOLD;
  }

  clone(newId: string): IDrawing {
    return new CrossLine(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._crossLineOptions }
    );
  }

  static create(
    id: string,
    anchor: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<CrossLineOptions>
  ): CrossLine {
    return new CrossLine(id, [anchor], style, options);
  }
}
