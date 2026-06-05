import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { FibWedge } from './fib-wedge';
import { FIB_WEDGE_LEVELS } from './fib-wedge';
import { applyStyle, drawLine, drawControlPoints, drawText } from '../../rendering/canvas-utils';

export class FibWedgePaneView implements IPrimitivePaneView {
  private _renderer: FibWedgePaneRenderer;

  constructor(drawing: FibWedge) {
    this._renderer = new FibWedgePaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class FibWedgePaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: FibWedge;

  constructor(drawing: FibWedge) {
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
    const apex = this._drawing.anchorToPixel(anchors[0], viewport);
    const p1 = this._drawing.anchorToPixel(anchors[1], viewport);
    const p2 = this._drawing.anchorToPixel(anchors[2], viewport);

    if (!apex || !p1 || !p2) return;

    const options = this._drawing.fibOptions;
    const levels = options.levels ?? FIB_WEDGE_LEVELS;

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Draw fill if enabled
    if (options.filled && this._drawing.style.fillColor) {
      ctx.fillStyle = this._drawing.style.fillColor;
      ctx.beginPath();
      ctx.moveTo(apex.x * pixelRatio, apex.y * pixelRatio);
      ctx.lineTo(p1.x * pixelRatio, p1.y * pixelRatio);
      ctx.lineTo(p2.x * pixelRatio, p2.y * pixelRatio);
      ctx.closePath();
      ctx.fill();
    }

    // Draw boundary lines
    drawLine(ctx, apex, p1, pixelRatio);
    drawLine(ctx, apex, p2, pixelRatio);

    // Draw intermediate Fibonacci lines
    for (const level of levels) {
      if (level === 0 || level === 1) continue;

      const end = this._drawing.getWedgeLineEnd(apex, p1, p2, level);

      const isMainLevel = level === 0.382 || level === 0.5 || level === 0.618;
      ctx.globalAlpha = isMainLevel ? 0.8 : 0.5;
      drawLine(ctx, apex, end, pixelRatio);
      ctx.globalAlpha = 1;

      // Draw label
      if (options.showLabels) {
        const labelPos = {
          x: (apex.x + end.x) / 2,
          y: (apex.y + end.y) / 2,
        };
        const text = `${(level * 100).toFixed(1)}%`;
        drawText(ctx, text, labelPos, '10px sans-serif', this._drawing.style.lineColor || '#fff', 'left', 'middle', pixelRatio);
      }
    }

    // Draw base line connecting p1 and p2
    ctx.globalAlpha = 0.5;
    drawLine(ctx, p1, p2, pixelRatio);
    ctx.globalAlpha = 1;

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
