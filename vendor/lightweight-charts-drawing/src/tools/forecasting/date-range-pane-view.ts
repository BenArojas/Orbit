import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { DateRange } from './date-range';
import { drawLine, drawControlPoints } from '../../rendering/canvas-utils';

export class DateRangePaneView implements IPrimitivePaneView {
  private _renderer: DateRangePaneRenderer;

  constructor(drawing: DateRange) {
    this._renderer = new DateRangePaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'bottom';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class DateRangePaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: DateRange;

  constructor(drawing: DateRange) {
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

    const anchors = this._drawing.anchors;
    const p1 = this._drawing.anchorToPixel(anchors[0], viewport);
    const p2 = this._drawing.anchorToPixel(anchors[1], viewport);

    if (!p1 || !p2) return;

    const options = this._drawing.dateRangeOptions;
    const info = this._drawing.getDateRangeInfo();
    const lineColor = this._drawing.style.lineColor || '#2196F3';

    const left = Math.min(p1.x, p2.x);
    const right = Math.max(p1.x, p2.x);
    const width = right - left;
    const height = bitmapSize.height / pixelRatio;

    // Draw filled background
    if (options.filled) {
      ctx.fillStyle = lineColor + '20';
      ctx.fillRect(left * pixelRatio, 0, width * pixelRatio, height * pixelRatio);
    }

    // Draw vertical lines at boundaries
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1 * pixelRatio;
    ctx.setLineDash([5 * pixelRatio, 3 * pixelRatio]);

    drawLine(ctx, { x: p1.x, y: 0 }, { x: p1.x, y: height }, pixelRatio);
    drawLine(ctx, { x: p2.x, y: 0 }, { x: p2.x, y: height }, pixelRatio);

    ctx.setLineDash([]);

    // Draw horizontal connecting line
    const midY = height / 2;
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2 * pixelRatio;
    drawLine(ctx, { x: left, y: midY }, { x: right, y: midY }, pixelRatio);

    // Draw arrows at ends
    const arrowSize = 8;
    ctx.fillStyle = lineColor;

    // Left arrow
    ctx.beginPath();
    ctx.moveTo(left * pixelRatio, midY * pixelRatio);
    ctx.lineTo((left + arrowSize) * pixelRatio, (midY - arrowSize / 2) * pixelRatio);
    ctx.lineTo((left + arrowSize) * pixelRatio, (midY + arrowSize / 2) * pixelRatio);
    ctx.closePath();
    ctx.fill();

    // Right arrow
    ctx.beginPath();
    ctx.moveTo(right * pixelRatio, midY * pixelRatio);
    ctx.lineTo((right - arrowSize) * pixelRatio, (midY - arrowSize / 2) * pixelRatio);
    ctx.lineTo((right - arrowSize) * pixelRatio, (midY + arrowSize / 2) * pixelRatio);
    ctx.closePath();
    ctx.fill();

    // Draw info label
    const centerX = (left + right) / 2;
    const fontSize = 12;
    ctx.font = `${fontSize * pixelRatio}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    // Background for text
    let labelText = '';
    if (options.showBars) {
      labelText += `${info.bars} bars`;
    }
    if (options.showDays) {
      if (labelText) labelText += ' | ';
      labelText += `${info.days} days`;
    }

    if (labelText) {
      const textMetrics = ctx.measureText(labelText);
      const textWidth = textMetrics.width / pixelRatio;
      const padding = 6;
      const labelY = midY - 10;

      // Draw label background
      ctx.fillStyle = '#1e222d';
      ctx.fillRect(
        (centerX - textWidth / 2 - padding) * pixelRatio,
        (labelY - fontSize - padding) * pixelRatio,
        (textWidth + padding * 2) * pixelRatio,
        (fontSize + padding * 2) * pixelRatio
      );

      // Draw label border
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1 * pixelRatio;
      ctx.strokeRect(
        (centerX - textWidth / 2 - padding) * pixelRatio,
        (labelY - fontSize - padding) * pixelRatio,
        (textWidth + padding * 2) * pixelRatio,
        (fontSize + padding * 2) * pixelRatio
      );

      // Draw text
      ctx.fillStyle = '#ffffff';
      ctx.fillText(labelText, centerX * pixelRatio, labelY * pixelRatio);
    }

    // Draw date labels if enabled
    if (options.showDates) {
      ctx.font = `${10 * pixelRatio}px sans-serif`;
      ctx.fillStyle = lineColor;

      // Start date
      const startDate = this.formatTime(info.startTime);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(startDate, p1.x * pixelRatio, (height - 25) * pixelRatio);

      // End date
      const endDate = this.formatTime(info.endTime);
      ctx.fillText(endDate, p2.x * pixelRatio, (height - 25) * pixelRatio);
    }

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }

  private formatTime(time: any): string {
    if (typeof time === 'string') {
      return time;
    }
    if (typeof time === 'number') {
      const date = new Date(time * 1000);
      return date.toISOString().split('T')[0];
    }
    return String(time);
  }
}
