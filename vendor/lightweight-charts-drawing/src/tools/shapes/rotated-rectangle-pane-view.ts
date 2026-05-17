import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { RotatedRectangle } from './rotated-rectangle';
import { applyStyle, drawControlPoints } from '../../rendering/canvas-utils';

export class RotatedRectanglePaneView implements IPrimitivePaneView {
  private _renderer: RotatedRectanglePaneRenderer;

  constructor(drawing: RotatedRectangle) {
    this._renderer = new RotatedRectanglePaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class RotatedRectanglePaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: RotatedRectangle;

  constructor(drawing: RotatedRectangle) {
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

    const corners = this._drawing.getCorners(viewport);
    if (!corners || corners.length < 4) return;

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Draw fill if enabled
    if (this._drawing.rotatedRectangleOptions.filled && this._drawing.style.fillColor) {
      ctx.fillStyle = this._drawing.style.fillColor;
      ctx.beginPath();
      ctx.moveTo(corners[0].x * pixelRatio, corners[0].y * pixelRatio);
      for (let i = 1; i < corners.length; i++) {
        ctx.lineTo(corners[i].x * pixelRatio, corners[i].y * pixelRatio);
      }
      ctx.closePath();
      ctx.fill();
    }

    // Draw border
    ctx.beginPath();
    ctx.moveTo(corners[0].x * pixelRatio, corners[0].y * pixelRatio);
    for (let i = 1; i < corners.length; i++) {
      ctx.lineTo(corners[i].x * pixelRatio, corners[i].y * pixelRatio);
    }
    ctx.closePath();
    ctx.stroke();

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
