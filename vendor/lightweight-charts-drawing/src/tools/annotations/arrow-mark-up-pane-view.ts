import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { ArrowMarkUp } from './arrow-mark-up';
import { drawControlPoints } from '../../rendering/canvas-utils';

export class ArrowMarkUpPaneView implements IPrimitivePaneView {
  private _renderer: ArrowMarkUpPaneRenderer;

  constructor(drawing: ArrowMarkUp) {
    this._renderer = new ArrowMarkUpPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class ArrowMarkUpPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: ArrowMarkUp;

  constructor(drawing: ArrowMarkUp) {
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

    const vertices = this._drawing.getArrowVertices(viewport);
    if (!vertices || vertices.length < 3) return;

    const style = this._drawing.style;

    ctx.save();

    // Draw filled arrow
    ctx.beginPath();
    ctx.moveTo(vertices[0].x * pixelRatio, vertices[0].y * pixelRatio);
    for (let i = 1; i < vertices.length; i++) {
      ctx.lineTo(vertices[i].x * pixelRatio, vertices[i].y * pixelRatio);
    }
    ctx.closePath();

    ctx.fillStyle = style.lineColor;
    ctx.fill();

    // Optional stroke for definition
    ctx.strokeStyle = style.lineColor;
    ctx.lineWidth = 1 * pixelRatio;
    ctx.stroke();

    ctx.restore();

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
