import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { DatePriceRange } from './date-price-range';
import { drawLine, drawControlPoints } from '../../rendering/canvas-utils';

export class DatePriceRangePaneView implements IPrimitivePaneView {
  private _renderer: DatePriceRangePaneRenderer;

  constructor(drawing: DatePriceRange) {
    this._renderer = new DatePriceRangePaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class DatePriceRangePaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: DatePriceRange;

  constructor(drawing: DatePriceRange) {
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
    const p1 = this._drawing.anchorToPixel(anchors[0], viewport);
    const p2 = this._drawing.anchorToPixel(anchors[1], viewport);

    if (!p1 || !p2) return;

    const options = this._drawing.measureOptions;
    const info = this._drawing.getMeasureInfo();

    const left = Math.min(p1.x, p2.x);
    const right = Math.max(p1.x, p2.x);
    const top = Math.min(p1.y, p2.y);
    const bottom = Math.max(p1.y, p2.y);
    const width = right - left;
    const height = bottom - top;

    // Choose color based on direction
    const color = info.isUp ? '#26a69a' : '#ef5350';

    // Draw filled background
    if (options.filled) {
      ctx.fillStyle = color + '20';
      ctx.fillRect(left * pixelRatio, top * pixelRatio, width * pixelRatio, height * pixelRatio);
    }

    // Draw border
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 * pixelRatio;
    ctx.strokeRect(left * pixelRatio, top * pixelRatio, width * pixelRatio, height * pixelRatio);

    // Draw diagonal measurement line
    ctx.lineWidth = 2 * pixelRatio;
    drawLine(ctx, p1, p2, pixelRatio);

    // Draw horizontal and vertical guide lines
    ctx.setLineDash([3 * pixelRatio, 3 * pixelRatio]);
    ctx.lineWidth = 1 * pixelRatio;
    ctx.globalAlpha = 0.5;

    // Horizontal line from p1
    drawLine(ctx, p1, { x: p2.x, y: p1.y }, pixelRatio);
    // Vertical line from horizontal end to p2
    drawLine(ctx, { x: p2.x, y: p1.y }, p2, pixelRatio);

    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Draw info panel
    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;
    const fontSize = 11;
    const lineHeight = fontSize + 4;
    const padding = 8;

    // Build info lines
    const lines: string[] = [];

    if (options.showPrices) {
      const sign = info.priceChange >= 0 ? '+' : '';
      lines.push(`${sign}$${info.priceChange.toFixed(2)}`);
    }

    if (options.showPercentage) {
      const sign = info.priceChangePercent >= 0 ? '+' : '';
      lines.push(`${sign}${info.priceChangePercent.toFixed(2)}%`);
    }

    if (options.showBars) {
      lines.push(`${info.bars} bars`);
    }

    if (options.showDays) {
      lines.push(`${info.days} days`);
    }

    if (lines.length > 0) {
      ctx.font = `${fontSize * pixelRatio}px sans-serif`;

      // Calculate panel dimensions
      let maxWidth = 0;
      for (const line of lines) {
        const textWidth = ctx.measureText(line).width / pixelRatio;
        maxWidth = Math.max(maxWidth, textWidth);
      }

      const panelWidth = maxWidth + padding * 2;
      const panelHeight = lines.length * lineHeight + padding * 2;
      const panelX = centerX - panelWidth / 2;
      const panelY = centerY - panelHeight / 2;

      // Draw panel background
      ctx.fillStyle = '#1e222d';
      ctx.fillRect(
        panelX * pixelRatio,
        panelY * pixelRatio,
        panelWidth * pixelRatio,
        panelHeight * pixelRatio
      );

      // Draw panel border
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 * pixelRatio;
      ctx.strokeRect(
        panelX * pixelRatio,
        panelY * pixelRatio,
        panelWidth * pixelRatio,
        panelHeight * pixelRatio
      );

      // Draw text
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let i = 0; i < lines.length; i++) {
        const textY = panelY + padding + (i + 0.5) * lineHeight;
        ctx.fillText(lines[i], centerX * pixelRatio, textY * pixelRatio);
      }
    }

    // Draw start/end markers
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p1.x * pixelRatio, p1.y * pixelRatio, 4 * pixelRatio, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(p2.x * pixelRatio, p2.y * pixelRatio, 4 * pixelRatio, 0, Math.PI * 2);
    ctx.fill();

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
