import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { PriceLabel } from './price-label';
import { drawControlPoints } from '../../rendering/canvas-utils';

export class PriceLabelPaneView implements IPrimitivePaneView {
  private _renderer: PriceLabelPaneRenderer;

  constructor(drawing: PriceLabel) {
    this._renderer = new PriceLabelPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class PriceLabelPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: PriceLabel;

  constructor(drawing: PriceLabel) {
    this._drawing = drawing;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace((scope: BitmapCoordinatesRenderingScope) => {
      this.drawImpl(scope);
    });
  }

  private drawImpl(scope: BitmapCoordinatesRenderingScope): void {
    const { context: ctx, horizontalPixelRatio, bitmapSize } = scope;
    const pixelRatio = horizontalPixelRatio;

    const viewport = this._drawing.getViewport();
    if (!viewport) return;
    if (!this._drawing.options.visible) return;
    if (!this._drawing.isValid()) return;

    const anchor = this._drawing.anchors[0];
    const p = this._drawing.anchorToPixel(anchor, viewport);
    if (!p) return;

    const options = this._drawing.labelOptions;
    const fontSize = (options.fontSize ?? 11) * pixelRatio;
    const backgroundColor = options.backgroundColor ?? '#2962FF';
    const textColor = options.textColor ?? '#FFFFFF';
    const decimals = options.decimals ?? 2;
    const padding = 4 * pixelRatio;
    const arrowSize = 6 * pixelRatio;

    const x = p.x * pixelRatio;
    const y = p.y * pixelRatio;
    const chartWidth = bitmapSize.width;

    ctx.save();

    // Draw horizontal line from anchor to right edge
    ctx.strokeStyle = backgroundColor;
    ctx.lineWidth = 1 * pixelRatio;
    ctx.setLineDash([4 * pixelRatio, 2 * pixelRatio]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(chartWidth, y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw price label on the right
    const priceText = `$${anchor.price.toFixed(decimals)}`;
    ctx.font = `bold ${fontSize}px sans-serif`;
    const textMetrics = ctx.measureText(priceText);
    const textWidth = textMetrics.width;
    const labelWidth = textWidth + padding * 2;
    const labelHeight = fontSize + padding * 2;

    const labelX = chartWidth - labelWidth - 2 * pixelRatio;
    const labelY = y - labelHeight / 2;

    // Draw label background with arrow
    ctx.fillStyle = backgroundColor;
    ctx.beginPath();

    if (options.showArrow) {
      // Label with arrow pointing left
      ctx.moveTo(labelX, labelY);
      ctx.lineTo(labelX + labelWidth, labelY);
      ctx.lineTo(labelX + labelWidth, labelY + labelHeight);
      ctx.lineTo(labelX, labelY + labelHeight);
      ctx.lineTo(labelX - arrowSize, y);
      ctx.closePath();
    } else {
      ctx.roundRect(labelX, labelY, labelWidth, labelHeight, 2 * pixelRatio);
    }
    ctx.fill();

    // Draw text
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(priceText, labelX + labelWidth / 2, y);

    // Draw anchor marker
    ctx.fillStyle = backgroundColor;
    ctx.beginPath();
    ctx.arc(x, y, 4 * pixelRatio, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
