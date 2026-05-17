import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { GannSquareFixed } from './gann-square-fixed';
import { GANN_SQUARE_LEVELS } from './gann-square-fixed';
import { applyStyle, drawLine, drawRect, drawControlPoints, drawDashedLine, drawLabel } from '../../rendering/canvas-utils';

export class GannSquareFixedPaneView implements IPrimitivePaneView {
  private _renderer: GannSquareFixedPaneRenderer;

  constructor(drawing: GannSquareFixed) {
    this._renderer = new GannSquareFixedPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class GannSquareFixedPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: GannSquareFixed;

  constructor(drawing: GannSquareFixed) {
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
    const center = this._drawing.anchorToPixel(anchors[0], viewport);

    if (!center) return;

    const options = this._drawing.gannOptions;
    const halfSize = this._drawing.getSquarePixelSize(viewport) / 2;
    const levels = options.levels ?? GANN_SQUARE_LEVELS;

    const left = center.x - halfSize;
    const right = center.x + halfSize;
    const top = center.y - halfSize;
    const bottom = center.y + halfSize;
    const size = halfSize * 2;

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Draw fill if enabled
    if (options.filled && this._drawing.style.fillColor) {
      ctx.fillStyle = this._drawing.style.fillColor;
      ctx.fillRect(left * pixelRatio, top * pixelRatio, size * pixelRatio, size * pixelRatio);
    }

    // Draw outer rectangle
    drawRect(ctx, { x: left, y: top }, size, size, false, pixelRatio);

    // Draw horizontal lines
    ctx.globalAlpha = 0.5;
    for (const level of levels) {
      if (level === 0 || level === 1) continue;
      const y = top + size * level;
      const isCardinal = level === 0.5;

      if (isCardinal) {
        ctx.globalAlpha = 0.8;
        drawLine(ctx, { x: left, y }, { x: right, y }, pixelRatio);
        ctx.globalAlpha = 0.5;
      } else {
        drawDashedLine(ctx, { x: left, y }, { x: right, y }, [3, 3], pixelRatio);
      }

      // Level label
      if (options.showLabels) {
        drawLabel(
          ctx,
          `${(level * 100).toFixed(0)}%`,
          { x: right + 5, y },
          {
            font: '10px sans-serif',
            textColor: this._drawing.style.lineColor,
            backgroundColor: 'transparent',
            padding: 2,
          },
          pixelRatio
        );
      }
    }

    // Draw vertical lines
    for (const level of levels) {
      if (level === 0 || level === 1) continue;
      const x = left + size * level;
      const isCardinal = level === 0.5;

      if (isCardinal) {
        ctx.globalAlpha = 0.8;
        drawLine(ctx, { x, y: top }, { x, y: bottom }, pixelRatio);
        ctx.globalAlpha = 0.5;
      } else {
        drawDashedLine(ctx, { x, y: top }, { x, y: bottom }, [3, 3], pixelRatio);
      }
    }
    ctx.globalAlpha = 1;

    // Draw diagonals (ordinal cross)
    if (options.showDiagonals) {
      ctx.globalAlpha = 0.7;
      drawLine(ctx, { x: left, y: top }, { x: right, y: bottom }, pixelRatio);
      drawLine(ctx, { x: left, y: bottom }, { x: right, y: top }, pixelRatio);
      ctx.globalAlpha = 1;
    }

    // Draw arcs at corners if enabled
    if (options.showArcs) {
      ctx.globalAlpha = 0.4;
      const arcRadius = size / 4;

      // Top-left corner arc
      ctx.beginPath();
      ctx.arc(left * pixelRatio, top * pixelRatio, arcRadius * pixelRatio, 0, Math.PI / 2);
      ctx.stroke();

      // Top-right corner arc
      ctx.beginPath();
      ctx.arc(right * pixelRatio, top * pixelRatio, arcRadius * pixelRatio, Math.PI / 2, Math.PI);
      ctx.stroke();

      // Bottom-right corner arc
      ctx.beginPath();
      ctx.arc(right * pixelRatio, bottom * pixelRatio, arcRadius * pixelRatio, Math.PI, Math.PI * 1.5);
      ctx.stroke();

      // Bottom-left corner arc
      ctx.beginPath();
      ctx.arc(left * pixelRatio, bottom * pixelRatio, arcRadius * pixelRatio, Math.PI * 1.5, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = 1;
    }

    // Draw center point marker
    ctx.beginPath();
    ctx.arc(center.x * pixelRatio, center.y * pixelRatio, 3 * pixelRatio, 0, Math.PI * 2);
    ctx.fill();

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
