import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { Ellipse } from './ellipse';
import { drawControlPoints } from '../../rendering/canvas-utils';

export class EllipsePaneView implements IPrimitivePaneView {
  private _renderer: EllipsePaneRenderer;

  constructor(drawing: Ellipse) {
    this._renderer = new EllipsePaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class EllipsePaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: Ellipse;

  constructor(drawing: Ellipse) {
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

    const params = this._drawing.getEllipseParams(viewport);
    if (!params) return;

    const { center, radiusX, radiusY } = params;
    const options = this._drawing.ellipseOptions;
    const style = this._drawing.style;

    ctx.save();

    // Draw fill if enabled
    if (options.filled && style.fillColor) {
      ctx.fillStyle = style.fillColor;
      ctx.globalAlpha = style.fillOpacity ?? 0.1;
      ctx.beginPath();
      ctx.ellipse(
        center.x * pixelRatio,
        center.y * pixelRatio,
        radiusX * pixelRatio,
        radiusY * pixelRatio,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Draw stroke
    ctx.strokeStyle = style.lineColor;
    ctx.lineWidth = style.lineWidth * pixelRatio;
    if (style.lineDash && style.lineDash.length > 0) {
      ctx.setLineDash(style.lineDash.map(d => d * pixelRatio));
    }

    ctx.beginPath();
    ctx.ellipse(
      center.x * pixelRatio,
      center.y * pixelRatio,
      radiusX * pixelRatio,
      radiusY * pixelRatio,
      0,
      0,
      Math.PI * 2
    );
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
