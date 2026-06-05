import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { RegressionTrend } from './regression-trend';
import { extendLineToViewport } from '../../core/geometry';
import { applyStyle, drawLine, drawControlPoints, drawDashedLine } from '../../rendering/canvas-utils';

export class RegressionTrendPaneView implements IPrimitivePaneView {
  private _renderer: RegressionTrendPaneRenderer;

  constructor(drawing: RegressionTrend) {
    this._renderer = new RegressionTrendPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class RegressionTrendPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: RegressionTrend;

  constructor(drawing: RegressionTrend) {
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

    const options = this._drawing.channelOptions;
    const { slope, stdDev } = this._drawing.calculateRegression(p1, p2);
    const offset = stdDev * (options.standardDeviations ?? 2);

    // Calculate perpendicular offset
    const len = Math.sqrt(1 + slope * slope);
    const nx = -slope / len;
    const ny = 1 / len;
    const offsetX = nx * offset;
    const offsetY = ny * offset;

    // Calculate channel points
    const p1Upper = { x: p1.x + offsetX, y: p1.y + offsetY };
    const p2Upper = { x: p2.x + offsetX, y: p2.y + offsetY };
    const p1Lower = { x: p1.x - offsetX, y: p1.y - offsetY };
    const p2Lower = { x: p2.x - offsetX, y: p2.y - offsetY };

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Handle extensions
    let drawP1 = p1, drawP2 = p2;
    let drawP1U = p1Upper, drawP2U = p2Upper;
    let drawP1L = p1Lower, drawP2L = p2Lower;

    if (options.extendLines) {
      const extendedMid = extendLineToViewport(p1, p2, viewport.width, viewport.height, true, true);
      const extendedUpper = extendLineToViewport(p1Upper, p2Upper, viewport.width, viewport.height, true, true);
      const extendedLower = extendLineToViewport(p1Lower, p2Lower, viewport.width, viewport.height, true, true);
      drawP1 = extendedMid.start;
      drawP2 = extendedMid.end;
      drawP1U = extendedUpper.start;
      drawP2U = extendedUpper.end;
      drawP1L = extendedLower.start;
      drawP2L = extendedLower.end;
    }

    // Draw fill if enabled
    if (options.filled && this._drawing.style.fillColor) {
      ctx.fillStyle = this._drawing.style.fillColor;
      ctx.beginPath();
      ctx.moveTo(drawP1U.x * pixelRatio, drawP1U.y * pixelRatio);
      ctx.lineTo(drawP2U.x * pixelRatio, drawP2U.y * pixelRatio);
      ctx.lineTo(drawP2L.x * pixelRatio, drawP2L.y * pixelRatio);
      ctx.lineTo(drawP1L.x * pixelRatio, drawP1L.y * pixelRatio);
      ctx.closePath();
      ctx.fill();
    }

    // Draw upper band
    drawLine(ctx, drawP1U, drawP2U, pixelRatio);

    // Draw lower band
    drawLine(ctx, drawP1L, drawP2L, pixelRatio);

    // Draw middle line (regression line) - dashed
    if (options.showMiddleLine) {
      drawDashedLine(ctx, drawP1, drawP2, [5, 5], pixelRatio);
    }

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
