import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { distanceToLineSegment } from '../../core/geometry';
import { FlatTopBottomPaneView } from './flat-top-bottom-pane-view';

/**
 * FlatTopBottom options
 */
export interface FlatTopBottomOptions extends DrawingOptions {
  filled?: boolean;
  extendLines?: boolean;
  flatPosition?: 'top' | 'bottom'; // Which line is flat (horizontal)
}

/**
 * FlatTopBottom - A channel where one side is flat (horizontal) and the other follows a trend.
 *
 * Features:
 * - Three anchor points: two for the trend line, one for the flat line level
 * - One horizontal line (flat)
 * - One diagonal line (trend)
 * - Optional fill between lines
 * - Optional line extensions
 */
export class FlatTopBottom extends Drawing {
  readonly type = 'flat-top-bottom';

  protected static readonly REQUIRED_ANCHORS = 3;
  protected static readonly HIT_THRESHOLD = 5;

  private _channelOptions: FlatTopBottomOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<FlatTopBottomOptions> = {}
  ) {
    const { filled, extendLines, flatPosition, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._channelOptions = {
      ...this._options,
      filled: filled ?? true,
      extendLines: extendLines ?? false,
      flatPosition: flatPosition ?? 'top',
    };
  }

  get channelOptions(): FlatTopBottomOptions {
    return this._channelOptions;
  }

  setChannelOptions(options: Partial<FlatTopBottomOptions>): void {
    this._channelOptions = { ...this._channelOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= FlatTopBottom.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new FlatTopBottomPaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    // p1, p2 define the trend line
    // p3 defines the flat line level (uses the price)
    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);
    const p3 = this.anchorToPixel(this._anchors[2], viewport);

    if (!p1 || !p2 || !p3) return [];

    const geometries: Geometry[] = [];

    // Trend line (p1 to p2)
    geometries.push({
      type: 'line',
      start: p1,
      end: p2,
      extendLeft: this._channelOptions.extendLines,
      extendRight: this._channelOptions.extendLines,
    } as LineGeometry);

    // Flat line (horizontal at p3.y, spanning from p1.x to p2.x)
    const flatY = p3.y;
    const flatStart = { x: p1.x, y: flatY };
    const flatEnd = { x: p2.x, y: flatY };

    geometries.push({
      type: 'line',
      start: flatStart,
      end: flatEnd,
      extendLeft: this._channelOptions.extendLines,
      extendRight: this._channelOptions.extendLines,
    } as LineGeometry);

    return geometries;
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);
    const p3 = this.anchorToPixel(this._anchors[2], viewport);

    if (!p1 || !p2 || !p3) return false;

    // Check trend line
    if (distanceToLineSegment(point, p1, p2) <= FlatTopBottom.HIT_THRESHOLD) return true;

    // Check flat line
    const flatY = p3.y;
    const flatStart = { x: p1.x, y: flatY };
    const flatEnd = { x: p2.x, y: flatY };
    if (distanceToLineSegment(point, flatStart, flatEnd) <= FlatTopBottom.HIT_THRESHOLD) return true;

    // If filled, check if inside channel
    if (this._channelOptions.filled) {
      const minX = Math.min(p1.x, p2.x);
      const maxX = Math.max(p1.x, p2.x);
      const minY = Math.min(p1.y, p2.y, flatY);
      const maxY = Math.max(p1.y, p2.y, flatY);

      if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) {
        return true;
      }
    }

    return false;
  }

  clone(newId: string): IDrawing {
    return new FlatTopBottom(
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
    flatLevel: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<FlatTopBottomOptions>
  ): FlatTopBottom {
    return new FlatTopBottom(id, [start, end, flatLevel], style, options);
  }
}
