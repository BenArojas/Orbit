import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { FibCircles } from './fib-circles';
import { FIB_CIRCLE_LEVELS } from './fib-circles';
import { distanceBetweenPoints } from '../../core/geometry';
import { applyStyle, drawControlPoints, drawText } from '../../rendering/canvas-utils';

export class FibCirclesPaneView implements IPrimitivePaneView {
  private _renderer: FibCirclesPaneRenderer;

  constructor(drawing: FibCircles) {
    this._renderer = new FibCirclesPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class FibCirclesPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: FibCircles;

  constructor(drawing: FibCircles) {
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
    const p1 = this._drawing.anchorToPixel(anchors[0], viewport); // Center
    const p2 = this._drawing.anchorToPixel(anchors[1], viewport); // Radius point

    if (!p1 || !p2) return;

    const options = this._drawing.fibOptions;
    const levels = options.levels ?? FIB_CIRCLE_LEVELS;
    const baseRadius = distanceBetweenPoints(p1, p2);

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Draw circles from largest to smallest for proper layering
    const sortedLevels = [...levels].sort((a, b) => b - a);

    for (const level of sortedLevels) {
      const radius = baseRadius * level;

      // Draw fill if enabled
      if (options.filled && this._drawing.style.fillColor) {
        ctx.fillStyle = this._drawing.style.fillColor;
        ctx.beginPath();
        ctx.arc(p1.x * pixelRatio, p1.y * pixelRatio, radius * pixelRatio, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw circle outline
      const isMainLevel = level === 0.382 || level === 0.5 || level === 0.618 || level === 1;
      ctx.globalAlpha = isMainLevel ? 1 : 0.6;
      ctx.beginPath();
      ctx.arc(p1.x * pixelRatio, p1.y * pixelRatio, radius * pixelRatio, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Draw label
      if (options.showLabels) {
        const text = `${(level * 100).toFixed(1)}%`;
        const labelPos = { x: p1.x + radius, y: p1.y };
        drawText(ctx, text, labelPos, '10px sans-serif', this._drawing.style.lineColor || '#fff', 'left', 'middle', pixelRatio);
      }
    }

    // Draw radius line
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(p1.x * pixelRatio, p1.y * pixelRatio);
    ctx.lineTo(p2.x * pixelRatio, p2.y * pixelRatio);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
