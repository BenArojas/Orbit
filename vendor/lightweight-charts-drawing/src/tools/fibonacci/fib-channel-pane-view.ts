import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { FibChannel } from './fib-channel';
import { FIB_CHANNEL_LEVELS } from './fib-channel';
import { extendLineToViewport } from '../../core/geometry';
import { applyStyle, drawLine, drawControlPoints, drawText } from '../../rendering/canvas-utils';

export class FibChannelPaneView implements IPrimitivePaneView {
  private _renderer: FibChannelPaneRenderer;

  constructor(drawing: FibChannel) {
    this._renderer = new FibChannelPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class FibChannelPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: FibChannel;

  constructor(drawing: FibChannel) {
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
    const levels = options.levels ?? FIB_CHANNEL_LEVELS;
    const offset = this._drawing.calculateOffset(p1, p2, p3);

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Draw fill between levels if enabled
    if (options.filled && this._drawing.style.fillColor) {
      ctx.fillStyle = this._drawing.style.fillColor;
      for (let i = 0; i < levels.length - 1; i++) {
        const level1 = levels[i];
        const level2 = levels[i + 1];

        const start1 = { x: p1.x + offset.x * level1, y: p1.y + offset.y * level1 };
        const end1 = { x: p2.x + offset.x * level1, y: p2.y + offset.y * level1 };
        const start2 = { x: p1.x + offset.x * level2, y: p1.y + offset.y * level2 };
        const end2 = { x: p2.x + offset.x * level2, y: p2.y + offset.y * level2 };

        ctx.beginPath();
        ctx.moveTo(start1.x * pixelRatio, start1.y * pixelRatio);
        ctx.lineTo(end1.x * pixelRatio, end1.y * pixelRatio);
        ctx.lineTo(end2.x * pixelRatio, end2.y * pixelRatio);
        ctx.lineTo(start2.x * pixelRatio, start2.y * pixelRatio);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Draw level lines
    for (const level of levels) {
      const offsetX = offset.x * level;
      const offsetY = offset.y * level;

      let start = { x: p1.x + offsetX, y: p1.y + offsetY };
      let end = { x: p2.x + offsetX, y: p2.y + offsetY };

      if (options.extendLines) {
        const extended = extendLineToViewport(start, end, viewport.width, viewport.height, true, true);
        start = extended.start;
        end = extended.end;
      }

      // Vary line opacity based on level importance
      const isMainLevel = level === 0 || level === 0.5 || level === 1 || level === 0.618;
      ctx.globalAlpha = isMainLevel ? 1 : 0.6;
      drawLine(ctx, start, end, pixelRatio);
      ctx.globalAlpha = 1;

      // Draw level label
      if (options.showPercentages) {
        const labelX = end.x + 5;
        const labelY = end.y;
        const text = `${(level * 100).toFixed(1)}%`;
        drawText(ctx, text, { x: labelX, y: labelY }, '10px sans-serif', this._drawing.style.lineColor || '#fff', 'left', 'middle', pixelRatio);
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
