import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { Arrow } from './arrow';
import { applyStyle, drawLine, drawControlPoints, drawFilledArrowHead } from '../../rendering/canvas-utils';

export class ArrowPaneView implements IPrimitivePaneView {
  private _renderer: ArrowPaneRenderer;

  constructor(drawing: Arrow) {
    this._renderer = new ArrowPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class ArrowPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: Arrow;

  constructor(drawing: Arrow) {
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
    const start = this._drawing.anchorToPixel(anchors[0], viewport);
    const end = this._drawing.anchorToPixel(anchors[1], viewport);

    if (!start || !end) return;

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Draw the line
    drawLine(ctx, start, end, pixelRatio);

    // Draw arrowhead at end
    ctx.fillStyle = this._drawing.style.lineColor;
    const arrowSize = this._drawing.arrowOptions.arrowSize ?? 12;
    drawFilledArrowHead(ctx, start, end, arrowSize, pixelRatio);

    // Draw arrowhead at start if both ends enabled
    if (this._drawing.arrowOptions.showBothEnds) {
      drawFilledArrowHead(ctx, end, start, arrowSize, pixelRatio);
    }

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
