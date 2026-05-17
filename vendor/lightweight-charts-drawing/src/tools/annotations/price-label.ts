import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry } from '../../core/geometry';
import { PriceLabelPaneView } from './price-label-pane-view';

/**
 * Price Label options
 */
export interface PriceLabelOptions extends DrawingOptions {
  fontSize?: number;
  backgroundColor?: string;
  textColor?: string;
  showArrow?: boolean;
  arrowDirection?: 'left' | 'right';
  decimals?: number;
}

/**
 * Price Label - A simple price label with arrow pointer.
 *
 * Features:
 * - Single anchor point
 * - Shows price value in a badge
 * - Arrow pointer to the price level
 * - Extends to the right edge
 */
export class PriceLabel extends Drawing {
  readonly type = 'price-label';

  protected static readonly REQUIRED_ANCHORS = 1;
  protected static readonly HIT_THRESHOLD = 10;

  private _labelOptions: PriceLabelOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<PriceLabelOptions> = {}
  ) {
    const { fontSize, backgroundColor, textColor, showArrow, arrowDirection, decimals, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._labelOptions = {
      ...this._options,
      fontSize: fontSize ?? 11,
      backgroundColor: backgroundColor ?? '#2962FF',
      textColor: textColor ?? '#FFFFFF',
      showArrow: showArrow ?? true,
      arrowDirection: arrowDirection ?? 'left',
      decimals: decimals ?? 2,
    };
  }

  get labelOptions(): PriceLabelOptions {
    return this._labelOptions;
  }

  setLabelOptions(options: Partial<PriceLabelOptions>): void {
    this._labelOptions = { ...this._labelOptions, ...options };
    this.requestUpdate();
  }

  getPrice(): number {
    return this._anchors[0]?.price ?? 0;
  }

  isValid(): boolean {
    return this._anchors.length >= PriceLabel.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new PriceLabelPaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p = this.anchorToPixel(this._anchors[0], viewport);
    if (!p) return [];

    return [{
      type: 'polygon',
      points: [p],
      closed: false,
    }];
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const p = this.anchorToPixel(this._anchors[0], viewport);
    if (!p) return false;

    // Check if near the label or the horizontal line
    const lineThreshold = 5;

    // Check horizontal line hit
    if (Math.abs(point.y - p.y) <= lineThreshold && point.x >= p.x) {
      return true;
    }

    // Check label hit (approximate)
    const labelWidth = 70;
    const labelHeight = 20;

    return (
      point.x >= viewport.width - labelWidth - 10 &&
      point.x <= viewport.width &&
      point.y >= p.y - labelHeight / 2 &&
      point.y <= p.y + labelHeight / 2
    );
  }

  clone(newId: string): IDrawing {
    return new PriceLabel(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._labelOptions }
    );
  }

  static create(
    id: string,
    position: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<PriceLabelOptions>
  ): PriceLabel {
    return new PriceLabel(id, [position], style, options);
  }
}
