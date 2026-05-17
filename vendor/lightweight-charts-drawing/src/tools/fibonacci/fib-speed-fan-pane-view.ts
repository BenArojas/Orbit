import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { FibSpeedFan } from './fib-speed-fan';
import { FIB_SPEED_RATIOS } from './fib-speed-fan';
import { extendLineToViewport } from '../../core/geometry';
import { applyStyle, drawLine, drawControlPoints, drawText } from '../../rendering/canvas-utils';

export class FibSpeedFanPaneView implements IPrimitivePaneView {
  private _renderer: FibSpeedFanPaneRenderer;

  constructor(drawing: FibSpeedFan) {
    this._renderer = new FibSpeedFanPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class FibSpeedFanPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: FibSpeedFan;

  constructor(drawing: FibSpeedFan) {
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

    const options = this._drawing.fibOptions;
    const ratios = options.ratios ?? FIB_SPEED_RATIOS;

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Draw fill between fan lines if enabled
    if (options.filled && this._drawing.style.fillColor) {
      ctx.fillStyle = this._drawing.style.fillColor;
      const sortedRatios = [...ratios].sort((a, b) => a - b);

      for (let i = 0; i < sortedRatios.length - 1; i++) {
        const end1 = this._drawing.getFanLineEnd(p1, p2, sortedRatios[i], viewport.width);
        const end2 = this._drawing.getFanLineEnd(p1, p2, sortedRatios[i + 1], viewport.width);

        ctx.beginPath();
        ctx.moveTo(p1.x * pixelRatio, p1.y * pixelRatio);
        ctx.lineTo(end1.x * pixelRatio, end1.y * pixelRatio);
        ctx.lineTo(end2.x * pixelRatio, end2.y * pixelRatio);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Draw fan lines
    for (const ratio of ratios) {
      let end = this._drawing.getFanLineEnd(p1, p2, ratio, viewport.width);

      if (options.extendLines) {
        const extended = extendLineToViewport(p1, end, viewport.width, viewport.height, false, true);
        end = extended.end;
      }

      // Main ratios get solid lines
      const isMainRatio = ratio === 0.382 || ratio === 0.5 || ratio === 0.618 || ratio === 1;
      ctx.globalAlpha = isMainRatio ? 1 : 0.6;
      drawLine(ctx, p1, end, pixelRatio);
      ctx.globalAlpha = 1;

      // Draw label
      if (options.showLabels) {
        const labelPos = {
          x: (p1.x + end.x) / 2,
          y: (p1.y + end.y) / 2,
        };
        const text = ratio === 1 ? '1:1' : `${ratio}`;
        drawText(ctx, text, labelPos, '10px sans-serif', this._drawing.style.lineColor || '#fff', 'left', 'middle', pixelRatio);
      }
    }

    // Draw main trend line
    drawLine(ctx, p1, p2, pixelRatio);

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
