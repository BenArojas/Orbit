import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { GannBox } from './gann-box';
import { GANN_LEVELS } from './gann-box';
import { applyStyle, drawLine, drawRect, drawControlPoints, drawDashedLine, drawLabel } from '../../rendering/canvas-utils';

export class GannBoxPaneView implements IPrimitivePaneView {
  private _renderer: GannBoxPaneRenderer;

  constructor(drawing: GannBox) {
    this._renderer = new GannBoxPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class GannBoxPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: GannBox;

  constructor(drawing: GannBox) {
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

    const options = this._drawing.gannOptions;
    const priceLevels = options.priceLevels ?? GANN_LEVELS;
    const timeLevels = options.timeLevels ?? GANN_LEVELS;

    const left = Math.min(p1.x, p2.x);
    const right = Math.max(p1.x, p2.x);
    const top = Math.min(p1.y, p2.y);
    const bottom = Math.max(p1.y, p2.y);
    const width = right - left;
    const height = bottom - top;

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Draw fill if enabled
    if (options.filled && this._drawing.style.fillColor) {
      ctx.fillStyle = this._drawing.style.fillColor;
      ctx.fillRect(left * pixelRatio, top * pixelRatio, width * pixelRatio, height * pixelRatio);
    }

    // Draw outer rectangle
    drawRect(ctx, { x: left, y: top }, width, height, false, pixelRatio);

    // Draw horizontal lines with labels
    ctx.globalAlpha = 0.6;
    for (const level of priceLevels) {
      if (level === 0 || level === 1) continue;
      const y = top + height * level;
      drawDashedLine(ctx, { x: left, y }, { x: right, y }, [3, 3], pixelRatio);

      // Level label
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

    // Draw vertical lines with labels
    for (const level of timeLevels) {
      if (level === 0 || level === 1) continue;
      const x = left + width * level;
      drawDashedLine(ctx, { x, y: top }, { x, y: bottom }, [3, 3], pixelRatio);
    }
    ctx.globalAlpha = 1;

    // Draw diagonals
    if (options.showDiagonals) {
      ctx.globalAlpha = 0.5;
      drawLine(ctx, { x: left, y: top }, { x: right, y: bottom }, pixelRatio);
      drawLine(ctx, { x: left, y: bottom }, { x: right, y: top }, pixelRatio);
      ctx.globalAlpha = 1;
    }

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
