import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { CrossLine } from './cross-line';
import { applyStyle, drawLine, drawControlPoints, drawLabel } from '../../rendering/canvas-utils';

export class CrossLinePaneView implements IPrimitivePaneView {
  private _renderer: CrossLinePaneRenderer;

  constructor(drawing: CrossLine) {
    this._renderer = new CrossLinePaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class CrossLinePaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: CrossLine;

  constructor(drawing: CrossLine) {
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
    const x = viewport.timeScale.timeToCoordinate(anchor.time);
    const y = viewport.priceScale.priceToCoordinate(anchor.price);

    if (x === null || y === null) return;

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Draw horizontal line
    drawLine(ctx, { x: 0, y }, { x: viewport.width, y }, pixelRatio);

    // Draw vertical line
    drawLine(ctx, { x, y: 0 }, { x, y: viewport.height }, pixelRatio);

    // Draw labels
    const options = this._drawing.crossLineOptions;

    if (options.showPrice) {
      drawLabel(
        ctx,
        anchor.price.toFixed(2),
        { x: viewport.width - 10, y },
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

    if (options.showTime) {
      drawLabel(
        ctx,
        String(anchor.time),
        { x, y: viewport.height - 10 },
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
