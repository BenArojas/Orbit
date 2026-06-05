import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { Arc } from './arc';
import { drawControlPoints } from '../../rendering/canvas-utils';

export class ArcPaneView implements IPrimitivePaneView {
  private _renderer: ArcPaneRenderer;

  constructor(drawing: Arc) {
    this._renderer = new ArcPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class ArcPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: Arc;

  constructor(drawing: Arc) {
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

    const params = this._drawing.getArcParams(viewport);
    if (!params) return;

    const { center, radius, startAngle, endAngle } = params;
    const options = this._drawing.arcOptions;
    const style = this._drawing.style;

    ctx.save();

    // Draw fill if enabled (pie slice)
    if (options.filled && style.fillColor) {
      ctx.fillStyle = style.fillColor;
      ctx.globalAlpha = style.fillOpacity ?? 0.1;
      ctx.beginPath();
      ctx.moveTo(center.x * pixelRatio, center.y * pixelRatio);
      ctx.arc(
        center.x * pixelRatio,
        center.y * pixelRatio,
        radius * pixelRatio,
        startAngle,
        endAngle
      );
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Draw arc stroke
    ctx.strokeStyle = style.lineColor;
    ctx.lineWidth = style.lineWidth * pixelRatio;
    if (style.lineDash && style.lineDash.length > 0) {
      ctx.setLineDash(style.lineDash.map(d => d * pixelRatio));
    }

    ctx.beginPath();
    ctx.arc(
      center.x * pixelRatio,
      center.y * pixelRatio,
      radius * pixelRatio,
      startAngle,
      endAngle
    );
    ctx.stroke();

    // Draw radial lines from center to endpoints if filled
    if (options.filled) {
      ctx.beginPath();
      ctx.moveTo(center.x * pixelRatio, center.y * pixelRatio);
      ctx.lineTo(
        (center.x + radius * Math.cos(startAngle)) * pixelRatio,
        (center.y + radius * Math.sin(startAngle)) * pixelRatio
      );
      ctx.moveTo(center.x * pixelRatio, center.y * pixelRatio);
      ctx.lineTo(
        (center.x + radius * Math.cos(endAngle)) * pixelRatio,
        (center.y + radius * Math.sin(endAngle)) * pixelRatio
      );
      ctx.stroke();
    }

    ctx.restore();

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
