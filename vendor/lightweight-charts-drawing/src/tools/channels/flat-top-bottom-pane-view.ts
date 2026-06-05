import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { FlatTopBottom } from './flat-top-bottom';
import { extendLineToViewport } from '../../core/geometry';
import { applyStyle, drawLine, drawControlPoints } from '../../rendering/canvas-utils';

export class FlatTopBottomPaneView implements IPrimitivePaneView {
  private _renderer: FlatTopBottomPaneRenderer;

  constructor(drawing: FlatTopBottom) {
    this._renderer = new FlatTopBottomPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class FlatTopBottomPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: FlatTopBottom;

  constructor(drawing: FlatTopBottom) {
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

    const options = this._drawing.channelOptions;

    // Calculate flat line points
    const flatY = p3.y;
    const flatStart = { x: p1.x, y: flatY };
    const flatEnd = { x: p2.x, y: flatY };

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Handle extensions
    let drawP1 = p1, drawP2 = p2;
    let drawFlatStart = flatStart, drawFlatEnd = flatEnd;

    if (options.extendLines) {
      const extendedTrend = extendLineToViewport(p1, p2, viewport.width, viewport.height, true, true);
      const extendedFlat = extendLineToViewport(flatStart, flatEnd, viewport.width, viewport.height, true, true);
      drawP1 = extendedTrend.start;
      drawP2 = extendedTrend.end;
      drawFlatStart = extendedFlat.start;
      drawFlatEnd = extendedFlat.end;
    }

    // Draw fill if enabled
    if (options.filled && this._drawing.style.fillColor) {
      ctx.fillStyle = this._drawing.style.fillColor;
      ctx.beginPath();
      ctx.moveTo(drawP1.x * pixelRatio, drawP1.y * pixelRatio);
      ctx.lineTo(drawP2.x * pixelRatio, drawP2.y * pixelRatio);
      ctx.lineTo(drawFlatEnd.x * pixelRatio, drawFlatEnd.y * pixelRatio);
      ctx.lineTo(drawFlatStart.x * pixelRatio, drawFlatStart.y * pixelRatio);
      ctx.closePath();
      ctx.fill();
    }

    // Draw trend line
    drawLine(ctx, drawP1, drawP2, pixelRatio);

    // Draw flat line
    drawLine(ctx, drawFlatStart, drawFlatEnd, pixelRatio);

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
