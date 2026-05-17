import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { FibTimeZone } from './fib-time-zone';
import { FIB_TIME_INTERVALS } from './fib-time-zone';
import { applyStyle, drawLine, drawControlPoints, drawText } from '../../rendering/canvas-utils';

export class FibTimeZonePaneView implements IPrimitivePaneView {
  private _renderer: FibTimeZonePaneRenderer;

  constructor(drawing: FibTimeZone) {
    this._renderer = new FibTimeZonePaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class FibTimeZonePaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: FibTimeZone;

  constructor(drawing: FibTimeZone) {
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

    const options = this._drawing.fibOptions;
    const intervals = options.intervals ?? FIB_TIME_INTERVALS;
    const unitWidth = p2.x - p1.x;

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Draw fill between zones if enabled
    if (options.filled && this._drawing.style.fillColor) {
      ctx.fillStyle = this._drawing.style.fillColor;
      for (let i = 0; i < intervals.length - 1; i++) {
        const x1 = p1.x + unitWidth * intervals[i];
        const x2 = p1.x + unitWidth * intervals[i + 1];

        // Alternate fill for visual distinction
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

    // Draw vertical lines
    for (let i = 0; i < intervals.length; i++) {
      const interval = intervals[i];
      const x = p1.x + unitWidth * interval;

      // Skip if off screen
      if (x < 0 || x > viewport.width) continue;

      const start = { x, y: 0 };
      const end = { x, y: viewport.height };

      // Main Fibonacci numbers get solid lines, others get lighter
      const isFibNumber = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89].includes(interval);
      ctx.globalAlpha = isFibNumber ? 1 : 0.5;
      drawLine(ctx, start, end, pixelRatio);
      ctx.globalAlpha = 1;

      // Draw label at top
      if (options.showLabels) {
        const text = String(interval);
        drawText(ctx, text, { x: x + 3, y: 15 }, '10px sans-serif', this._drawing.style.lineColor || '#fff', 'left', 'middle', pixelRatio);
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
