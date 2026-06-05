import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { Rectangle } from './rectangle';
import type { Point } from '../../core/types';
import { applyStyle, drawRect, drawControlPoints, drawLabel } from '../../rendering/canvas-utils';

export class RectanglePaneView implements IPrimitivePaneView {
  private _renderer: RectanglePaneRenderer;

  constructor(drawing: Rectangle) {
    this._renderer = new RectanglePaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class RectanglePaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: Rectangle;

  constructor(drawing: Rectangle) {
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

    const topLeft: Point = {
      x: Math.min(p1.x, p2.x),
      y: Math.min(p1.y, p2.y),
    };
    const width = Math.abs(p2.x - p1.x);
    const height = Math.abs(p2.y - p1.y);

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Draw fill if enabled
    if (this._drawing.rectangleOptions.filled && this._drawing.style.fillColor) {
      ctx.fillStyle = this._drawing.style.fillColor;
      ctx.fillRect(
        topLeft.x * pixelRatio,
        topLeft.y * pixelRatio,
        width * pixelRatio,
        height * pixelRatio
      );
    }

    // Draw border
    drawRect(ctx, topLeft, width, height, false, pixelRatio);

    // Draw dimensions if enabled
    if (this._drawing.rectangleOptions.showDimensions) {
      const priceRange = this._drawing.getPriceRange();
      const labelText = `$${priceRange.range.toFixed(2)}`;
      const centerX = topLeft.x + width / 2;
      const centerY = topLeft.y + height / 2;

      drawLabel(
        ctx,
        labelText,
        { x: centerX, y: centerY },
        {
          font: this._drawing.style.labelFont || '12px sans-serif',
          textColor: '#ffffff',
          backgroundColor: this._drawing.style.lineColor + 'CC',
          padding: 4,
          borderRadius: 3,
        },
        pixelRatio
      );
    }

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
