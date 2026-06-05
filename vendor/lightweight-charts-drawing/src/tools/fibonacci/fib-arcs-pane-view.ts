import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { FibArcs } from './fib-arcs';
import { FIB_ARC_LEVELS } from './fib-arcs';
import { distanceBetweenPoints } from '../../core/geometry';
import { applyStyle, drawLine, drawControlPoints, drawText } from '../../rendering/canvas-utils';

export class FibArcsPaneView implements IPrimitivePaneView {
  private _renderer: FibArcsPaneRenderer;

  constructor(drawing: FibArcs) {
    this._renderer = new FibArcsPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class FibArcsPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: FibArcs;

  constructor(drawing: FibArcs) {
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
    const levels = options.levels ?? FIB_ARC_LEVELS;
    const baseRadius = distanceBetweenPoints(p1, p2);

    // Calculate arc direction
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const startAngle = options.fullCircle ? 0 : angle - Math.PI / 2;
    const endAngle = options.fullCircle ? Math.PI * 2 : angle + Math.PI / 2;

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Draw arcs
    for (const level of levels) {
      const radius = baseRadius * level;

      const isMainLevel = level === 0.382 || level === 0.5 || level === 0.618 || level === 1;
      ctx.globalAlpha = isMainLevel ? 1 : 0.6;

      ctx.beginPath();
      ctx.arc(
        p1.x * pixelRatio,
        p1.y * pixelRatio,
        radius * pixelRatio,
        startAngle,
        endAngle
      );
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Draw label
      if (options.showLabels) {
        const labelAngle = (startAngle + endAngle) / 2;
        const labelPos = {
          x: p1.x + radius * Math.cos(labelAngle),
          y: p1.y + radius * Math.sin(labelAngle),
        };
        const text = `${(level * 100).toFixed(1)}%`;
        drawText(ctx, text, labelPos, '10px sans-serif', this._drawing.style.lineColor || '#fff', 'left', 'middle', pixelRatio);
      }
    }

    // Draw baseline
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
