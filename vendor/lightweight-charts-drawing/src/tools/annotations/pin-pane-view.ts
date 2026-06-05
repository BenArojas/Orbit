import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { Pin } from './pin';
import { drawControlPoints } from '../../rendering/canvas-utils';

export class PinPaneView implements IPrimitivePaneView {
  private _renderer: PinPaneRenderer;

  constructor(drawing: Pin) {
    this._renderer = new PinPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class PinPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: Pin;

  constructor(drawing: Pin) {
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

    const anchor = this._drawing.anchors[0];
    const p = this._drawing.anchorToPixel(anchor, viewport);
    if (!p) return;

    const options = this._drawing.pinOptions;
    const color = options.color ?? '#E91E63';
    const size = (options.size ?? 24) * pixelRatio;

    const x = p.x * pixelRatio;
    const y = p.y * pixelRatio;

    ctx.save();

    // Draw teardrop pin shape
    const headRadius = size * 0.4;
    const headCenterY = y - size;

    // Pin body (teardrop) - path from tip to circle
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y); // tip at anchor
    // Left curve to circle
    ctx.bezierCurveTo(
      x - headRadius * 1.2, y - size * 0.5,
      x - headRadius, headCenterY,
      x, headCenterY - headRadius
    );
    // Right curve back to tip
    ctx.bezierCurveTo(
      x + headRadius, headCenterY,
      x + headRadius * 1.2, y - size * 0.5,
      x, y
    );
    ctx.closePath();
    ctx.fill();

    // Draw inner circle (white dot)
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(x, headCenterY, headRadius * 0.4, 0, Math.PI * 2);
    ctx.fill();

    // Draw label if present
    const label = options.label;
    if (label) {
      const fontSize = 10 * pixelRatio;
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';

      const textMetrics = ctx.measureText(label);
      const labelPadding = 3 * pixelRatio;
      const labelWidth = textMetrics.width + labelPadding * 2;
      const labelHeight = fontSize + labelPadding * 2;
      const labelX = x;
      const labelY = headCenterY - headRadius - 4 * pixelRatio;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.beginPath();
      ctx.roundRect(
        labelX - labelWidth / 2,
        labelY - labelHeight,
        labelWidth,
        labelHeight,
        2 * pixelRatio
      );
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(label, labelX, labelY - labelPadding);
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
