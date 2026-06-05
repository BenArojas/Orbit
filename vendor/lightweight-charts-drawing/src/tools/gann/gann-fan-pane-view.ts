import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { GannFan } from './gann-fan';
import { GANN_FAN_ANGLES } from './gann-fan';
import type { Point } from '../../core/types';
import { extendLineToViewport } from '../../core/geometry';
import { applyStyle, drawLine, drawControlPoints, drawLabel } from '../../rendering/canvas-utils';

// Colors for different Gann angles
const GANN_COLORS: Record<string, string> = {
  '8x1': '#F44336',
  '4x1': '#E91E63',
  '3x1': '#9C27B0',
  '2x1': '#673AB7',
  '1x1': '#2196F3',
  '1x2': '#00BCD4',
  '1x3': '#4CAF50',
  '1x4': '#8BC34A',
  '1x8': '#CDDC39',
};

export class GannFanPaneView implements IPrimitivePaneView {
  private _renderer: GannFanPaneRenderer;

  constructor(drawing: GannFan) {
    this._renderer = new GannFanPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class GannFanPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: GannFan;

  constructor(drawing: GannFan) {
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

    const options = this._drawing.gannOptions;
    const angles = options.angles ?? GANN_FAN_ANGLES;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const baseLen = Math.sqrt(dx * dx + dy * dy);

    if (baseLen === 0) return;

    const unitX = dx / baseLen;
    const unitY = dy / baseLen;

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Draw each fan line
    for (const angle of angles) {
      const fanDx = unitX * baseLen * 3;
      const fanDy = unitY * baseLen * 3 * angle.ratio;

      let end: Point = {
        x: p1.x + fanDx,
        y: p1.y + fanDy,
      };

      // Extend to viewport if enabled
      if (options.extendLines) {
        const extended = extendLineToViewport(p1, end, viewport.width, viewport.height, false, true);
        end = extended.end;
      }

      // Use angle-specific color
      const color = GANN_COLORS[angle.label] ?? this._drawing.style.lineColor;
      ctx.strokeStyle = color;
      ctx.lineWidth = (angle.label === '1x1' ? 2 : 1) * this._drawing.style.lineWidth * pixelRatio;

      drawLine(ctx, p1, end, pixelRatio);

      // Draw label
      if (options.showLabels) {
        const labelPos = {
          x: p1.x + fanDx * 0.3,
          y: p1.y + fanDy * 0.3,
        };

        drawLabel(
          ctx,
          angle.label,
          labelPos,
          {
            font: '10px sans-serif',
            textColor: '#ffffff',
            backgroundColor: color + 'CC',
            padding: 2,
            borderRadius: 2,
          },
          pixelRatio
        );
      }
    }

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
