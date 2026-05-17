import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { Ray } from './ray';
import { extendLineToViewport, getLineAngleDegrees, midpoint } from '../../core/geometry';
import { applyStyle, drawLine, drawControlPoints, drawLabel } from '../../rendering/canvas-utils';

export class RayPaneView implements IPrimitivePaneView {
  private _renderer: RayPaneRenderer;

  constructor(drawing: Ray) {
    this._renderer = new RayPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class RayPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: Ray;

  constructor(drawing: Ray) {
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

    // Extend line to the right
    const extended = extendLineToViewport(
      start,
      end,
      viewport.width,
      viewport.height,
      false,
      true
    );

    drawLine(ctx, start, extended.end, pixelRatio);

    // Draw angle label if enabled
    if (this._drawing.rayOptions.showAngle) {
      const angle = getLineAngleDegrees(start, end);
      const labelPos = midpoint(start, end);
      drawLabel(
        ctx,
        `${angle.toFixed(1)}°`,
        { x: labelPos.x, y: labelPos.y - 15 },
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
