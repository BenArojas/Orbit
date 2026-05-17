import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { PriceRange } from './price-range';
import { applyStyle, drawLine, drawControlPoints, drawLabel } from '../../rendering/canvas-utils';

export class PriceRangePaneView implements IPrimitivePaneView {
  private _renderer: PriceRangePaneRenderer;

  constructor(drawing: PriceRange) {
    this._renderer = new PriceRangePaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'bottom'; // Price range should be behind other drawings
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class PriceRangePaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: PriceRange;

  constructor(drawing: PriceRange) {
    this._drawing = drawing;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace((scope: BitmapCoordinatesRenderingScope) => {
      this.drawImpl(scope);
    });
  }

  private drawImpl(scope: BitmapCoordinatesRenderingScope): void {
    const { context: ctx, horizontalPixelRatio } = scope;
    const pixelRatio = horizontalPixelRatio;

    const viewport = this._drawing.getViewport();
    if (!viewport) return;
    if (!this._drawing.options.visible) return;
    if (!this._drawing.isValid()) return;

    const anchors = this._drawing.anchors;
    const y1 = viewport.priceScale.priceToCoordinate(anchors[0].price);
    const y2 = viewport.priceScale.priceToCoordinate(anchors[1].price);

    if (y1 === null || y2 === null) return;

    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    const height = bottom - top;

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Draw filled rectangle
    if (this._drawing.style.fillColor) {
      ctx.fillStyle = this._drawing.style.fillColor;
      ctx.fillRect(0, top * pixelRatio, viewport.width * pixelRatio, height * pixelRatio);
    }

    // Draw top and bottom borders
    drawLine(ctx, { x: 0, y: top }, { x: viewport.width, y: top }, pixelRatio);
    drawLine(ctx, { x: 0, y: bottom }, { x: viewport.width, y: bottom }, pixelRatio);

    // Draw labels
    const options = this._drawing.priceRangeOptions;
    const rangeInfo = this._drawing.getRangeInfo();
    const centerY = (top + bottom) / 2;

    const labelParts: string[] = [];

    if (options.showRange) {
      labelParts.push(`$${rangeInfo.range.toFixed(2)}`);
    }

    if (options.showPercentage) {
      const sign = rangeInfo.percentage >= 0 ? '+' : '';
      labelParts.push(`${sign}${rangeInfo.percentage.toFixed(2)}%`);
    }

    if (labelParts.length > 0) {
      drawLabel(
        ctx,
        labelParts.join(' | '),
        { x: viewport.width / 2, y: centerY },
        {
          font: this._drawing.style.labelFont || '12px sans-serif',
          textColor: '#ffffff',
          backgroundColor: this._drawing.style.lineColor + 'CC',
          padding: 6,
          borderRadius: 4,
        },
        pixelRatio
      );
    }

    // Draw price labels on the sides
    if (options.showPrices) {
      drawLabel(
        ctx,
        rangeInfo.max.toFixed(2),
        { x: viewport.width - 10, y: top },
        {
          font: '11px sans-serif',
          textColor: '#ffffff',
          backgroundColor: this._drawing.style.lineColor + 'AA',
          padding: 3,
          borderRadius: 2,
        },
        pixelRatio
      );

      drawLabel(
        ctx,
        rangeInfo.min.toFixed(2),
        { x: viewport.width - 10, y: bottom },
        {
          font: '11px sans-serif',
          textColor: '#ffffff',
          backgroundColor: this._drawing.style.lineColor + 'AA',
          padding: 3,
          borderRadius: 2,
        },
        pixelRatio
      );
    }

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
