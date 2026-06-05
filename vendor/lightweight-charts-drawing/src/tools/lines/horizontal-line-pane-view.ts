import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { HorizontalLine } from './horizontal-line';
import type { Point } from '../../core/types';
import { applyStyle, drawLine, drawControlPoints, drawLabel } from '../../rendering/canvas-utils';

export class HorizontalLinePaneView implements IPrimitivePaneView {
  private _renderer: HorizontalLinePaneRenderer;

  constructor(drawing: HorizontalLine) {
    this._renderer = new HorizontalLinePaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class HorizontalLinePaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: HorizontalLine;

  constructor(drawing: HorizontalLine) {
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
    const y = viewport.priceScale.priceToCoordinate(anchor.price);
    if (y === null) return;

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Draw horizontal line
    const start: Point = { x: 0, y };
    const end: Point = { x: viewport.width, y };
    drawLine(ctx, start, end, pixelRatio);

    // Draw price label
    const options = this._drawing.horizontalLineOptions;
    if (options.showPrice) {
      const priceText = options.labelText || anchor.price.toFixed(2);
      drawLabel(
        ctx,
        priceText,
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

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
