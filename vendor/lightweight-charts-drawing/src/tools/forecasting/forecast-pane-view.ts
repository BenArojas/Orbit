import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { Forecast } from './forecast';
import type { Point } from '../../core/types';
import { drawLine, drawControlPoints, drawDashedLine } from '../../rendering/canvas-utils';

export class ForecastPaneView implements IPrimitivePaneView {
  private _renderer: ForecastPaneRenderer;

  constructor(drawing: Forecast) {
    this._renderer = new ForecastPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class ForecastPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: Forecast;

  constructor(drawing: Forecast) {
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
    const p0 = this._drawing.anchorToPixel(anchors[0], viewport);
    const p1 = this._drawing.anchorToPixel(anchors[1], viewport);

    if (!p0 || !p1) return;

    const options = this._drawing.forecastOptions;
    const info = this._drawing.getForecastInfo();
    const color = info.isUp ? '#26a69a' : '#ef5350';
    const lineColor = this._drawing.style.lineColor || color;

    // Horizontal reference point
    const pH: Point = { x: p1.x, y: p0.y };

    // Draw filled zone
    if (options.filled) {
      const left = Math.min(p0.x, p1.x);
      const top = Math.min(p0.y, p1.y);
      const width = Math.abs(p1.x - p0.x);
      const height = Math.abs(p1.y - p0.y);

      ctx.fillStyle = color + '15';
      ctx.fillRect(left * pixelRatio, top * pixelRatio, width * pixelRatio, height * pixelRatio);
    }

    // Draw diagonal forecast line
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * pixelRatio;
    drawLine(ctx, p0, p1, pixelRatio);

    // Draw horizontal reference line (dashed)
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1 * pixelRatio;
    ctx.globalAlpha = 0.5;
    drawDashedLine(ctx, p0, pH, [5, 3], pixelRatio);

    // Draw vertical target line (dashed)
    drawDashedLine(ctx, pH, p1, [5, 3], pixelRatio);
    ctx.globalAlpha = 1;

    // Draw point markers
    const fontSize = 11;
    ctx.font = `bold ${fontSize * pixelRatio}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Start point
    ctx.fillStyle = lineColor;
    ctx.beginPath();
    ctx.arc(p0.x * pixelRatio, p0.y * pixelRatio, 5 * pixelRatio, 0, Math.PI * 2);
    ctx.fill();

    // Target point
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p1.x * pixelRatio, p1.y * pixelRatio, 5 * pixelRatio, 0, Math.PI * 2);
    ctx.fill();

    // Draw info labels
    if (options.showLabels) {
      const lines: string[] = [];

      if (options.showPrices) {
        lines.push(`Target: $${info.targetPrice.toFixed(2)}`);
      }

      if (options.showPercentage) {
        const sign = info.percentChange >= 0 ? '+' : '';
        lines.push(`${sign}${info.percentChange.toFixed(2)}%`);
      }

      if (lines.length > 0) {
        const panelX = p1.x + 10;
        const panelY = p1.y;
        const padding = 6;
        const lineHeight = fontSize + 3;

        ctx.font = `${fontSize * pixelRatio}px sans-serif`;

        let maxWidth = 0;
        for (const line of lines) {
          const textWidth = ctx.measureText(line).width / pixelRatio;
          maxWidth = Math.max(maxWidth, textWidth);
        }

        const boxWidth = maxWidth + padding * 2;
        const boxHeight = lines.length * lineHeight + padding * 2;

        // Background
        ctx.fillStyle = '#1e222d';
        ctx.fillRect(
          panelX * pixelRatio,
          (panelY - boxHeight / 2) * pixelRatio,
          boxWidth * pixelRatio,
          boxHeight * pixelRatio
        );

        // Border
        ctx.strokeStyle = color;
        ctx.lineWidth = 1 * pixelRatio;
        ctx.strokeRect(
          panelX * pixelRatio,
          (panelY - boxHeight / 2) * pixelRatio,
          boxWidth * pixelRatio,
          boxHeight * pixelRatio
        );

        // Text
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        for (let i = 0; i < lines.length; i++) {
          const textY = panelY - boxHeight / 2 + padding + i * lineHeight;
          ctx.fillText(lines[i], (panelX + padding) * pixelRatio, textY * pixelRatio);
        }
      }
    }

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
