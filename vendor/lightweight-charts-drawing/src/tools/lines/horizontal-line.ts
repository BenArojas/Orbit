import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry, TextGeometry } from '../../core/geometry';
import { HorizontalLinePaneView } from './horizontal-line-pane-view';

/**
 * HorizontalLine options
 */
export interface HorizontalLineOptions extends DrawingOptions {
  showPrice?: boolean;
  showLabel?: boolean;
  labelText?: string;
}

/**
 * HorizontalLine - A horizontal line at a specific price level.
 *
 * Features:
 * - Single anchor point (price level)
 * - Extends across entire viewport
 * - Optional price label
 * - Optional custom label text
 */
export class HorizontalLine extends Drawing {
  readonly type = 'horizontal-line';

  protected static readonly REQUIRED_ANCHORS = 1;
  protected static readonly HIT_THRESHOLD = 5;

  private _horizontalLineOptions: HorizontalLineOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<HorizontalLineOptions> = {}
  ) {
    const { showPrice, showLabel, labelText, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._horizontalLineOptions = {
      ...this._options,
      showPrice: showPrice ?? true,
      showLabel: showLabel ?? false,
      labelText: labelText ?? '',
    };
  }

  get horizontalLineOptions(): HorizontalLineOptions {
    return this._horizontalLineOptions;
  }

  setHorizontalLineOptions(options: Partial<HorizontalLineOptions>): void {
    this._horizontalLineOptions = { ...this._horizontalLineOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= HorizontalLine.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new HorizontalLinePaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const anchor = this._anchors[0];
    const y = viewport.priceScale.priceToCoordinate(anchor.price);
    if (y === null) return [];

    const geometries: Geometry[] = [];

    // Horizontal line spanning viewport
    const lineGeometry: LineGeometry = {
      type: 'line',
      start: { x: 0, y },
      end: { x: viewport.width, y },
    };
    geometries.push(lineGeometry);

    // Price label
    if (this._horizontalLineOptions.showPrice) {
      const priceText = anchor.price.toFixed(2);
      geometries.push({
        type: 'text',
        position: { x: viewport.width - 5, y: y - 10 },
        text: priceText,
        align: 'right',
        baseline: 'bottom',
        color: this._style.labelColor,
        font: this._style.labelFont,
      } as TextGeometry);
    }

    return geometries;
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const anchor = this._anchors[0];
    const y = viewport.priceScale.priceToCoordinate(anchor.price);
    if (y === null) return false;

    return Math.abs(point.y - y) <= HorizontalLine.HIT_THRESHOLD;
  }

  clone(newId: string): IDrawing {
    return new HorizontalLine(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._horizontalLineOptions }
    );
  }

  static create(
    id: string,
    price: number,
    time: number | string,
    style?: Partial<DrawingStyle>,
    options?: Partial<HorizontalLineOptions>
  ): HorizontalLine {
    return new HorizontalLine(id, [{ time: time as any, price }], style, options);
  }
}
