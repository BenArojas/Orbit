import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { FibTimeExtension } from './fib-time-extension';
import { FIB_TIME_EXTENSION_LEVELS } from './fib-time-extension';
import { applyStyle, drawLine, drawControlPoints, drawText } from '../../rendering/canvas-utils';

export class FibTimeExtensionPaneView implements IPrimitivePaneView {
  private _renderer: FibTimeExtensionPaneRenderer;

  constructor(drawing: FibTimeExtension) {
    this._renderer = new FibTimeExtensionPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class FibTimeExtensionPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: FibTimeExtension;

  constructor(drawing: FibTimeExtension) {
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
    const p3 = this._drawing.anchorToPixel(anchors[2], viewport);

    if (!p1 || !p2 || !p3) return;

    const options = this._drawing.fibOptions;
    const levels = options.levels ?? FIB_TIME_EXTENSION_LEVELS;
    const baseTimeWidth = p2.x - p1.x;

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Draw fill between levels if enabled
    if (options.filled && this._drawing.style.fillColor) {
      ctx.fillStyle = this._drawing.style.fillColor;
      for (let i = 0; i < levels.length - 1; i++) {
        const x1 = p3.x + baseTimeWidth * levels[i];
        const x2 = p3.x + baseTimeWidth * levels[i + 1];

        if (i % 2 === 0) {
          ctx.fillRect(
            x1 * pixelRatio,
            0,
            (x2 - x1) * pixelRatio,
            viewport.height * pixelRatio
          );
        }
      }
    }

    // Draw vertical lines at each level
    for (const level of levels) {
      const x = p3.x + baseTimeWidth * level;

      if (x < 0 || x > viewport.width) continue;

      const start = { x, y: 0 };
      const end = { x, y: viewport.height };

      const isMainLevel = level === 0 || level === 0.5 || level === 1 || level === 1.618;
      ctx.globalAlpha = isMainLevel ? 1 : 0.6;
      drawLine(ctx, start, end, pixelRatio);
      ctx.globalAlpha = 1;

      // Draw label
      if (options.showLabels) {
        const text = `${(level * 100).toFixed(1)}%`;
        drawText(ctx, text, { x: x + 3, y: 15 }, '10px sans-serif', this._drawing.style.lineColor || '#fff', 'left', 'middle', pixelRatio);
      }
    }

    // Draw connecting lines between anchor points
    ctx.globalAlpha = 0.5;
    drawLine(ctx, p1, p2, pixelRatio);
    drawLine(ctx, p2, p3, pixelRatio);
    ctx.globalAlpha = 1;

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
