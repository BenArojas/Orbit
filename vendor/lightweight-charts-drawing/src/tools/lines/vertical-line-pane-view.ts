import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { VerticalLine } from './vertical-line';
import type { Point } from '../../core/types';
import { applyStyle, drawLine, drawControlPoints, drawLabel } from '../../rendering/canvas-utils';

export class VerticalLinePaneView implements IPrimitivePaneView {
  private _renderer: VerticalLinePaneRenderer;

  constructor(drawing: VerticalLine) {
    this._renderer = new VerticalLinePaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class VerticalLinePaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: VerticalLine;

  constructor(drawing: VerticalLine) {
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
    if (x === null) return;

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Draw vertical line
    const start: Point = { x, y: 0 };
    const end: Point = { x, y: viewport.height };
    drawLine(ctx, start, end, pixelRatio);

    // Draw time label
    const options = this._drawing.verticalLineOptions;
    if (options.showTime) {
      const timeText = options.labelText || String(anchor.time);
      drawLabel(
        ctx,
        timeText,
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
