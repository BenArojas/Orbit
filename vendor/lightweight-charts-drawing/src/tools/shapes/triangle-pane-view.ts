import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { Triangle } from './triangle';
import type { Point } from '../../core/types';
import { applyStyle, drawControlPoints } from '../../rendering/canvas-utils';

export class TrianglePaneView implements IPrimitivePaneView {
  private _renderer: TrianglePaneRenderer;

  constructor(drawing: Triangle) {
    this._renderer = new TrianglePaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class TrianglePaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: Triangle;

  constructor(drawing: Triangle) {
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
    const points: Point[] = [];
    for (const anchor of anchors) {
      const p = this._drawing.anchorToPixel(anchor, viewport);
      if (!p) return;
      points.push(p);
    }

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Draw the triangle
    ctx.beginPath();
    ctx.moveTo(points[0].x * pixelRatio, points[0].y * pixelRatio);
    ctx.lineTo(points[1].x * pixelRatio, points[1].y * pixelRatio);
    ctx.lineTo(points[2].x * pixelRatio, points[2].y * pixelRatio);
    ctx.closePath();

    // Fill if enabled
    if (this._drawing.triangleOptions.filled && this._drawing.style.fillColor) {
      ctx.fillStyle = this._drawing.style.fillColor;
      ctx.fill();
    }

    ctx.stroke();

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
