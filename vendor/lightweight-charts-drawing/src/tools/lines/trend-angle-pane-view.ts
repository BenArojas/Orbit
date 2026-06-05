import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { TrendAngle } from './trend-angle';
import { getLineAngleDegrees } from '../../core/geometry';
import { applyStyle, drawLine, drawControlPoints, drawLabel } from '../../rendering/canvas-utils';

export class TrendAnglePaneView implements IPrimitivePaneView {
  private _renderer: TrendAnglePaneRenderer;

  constructor(drawing: TrendAngle) {
    this._renderer = new TrendAnglePaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class TrendAnglePaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: TrendAngle;

  constructor(drawing: TrendAngle) {
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

    // Draw main line
    drawLine(ctx, start, end, pixelRatio);

    const options = this._drawing.trendAngleOptions;

    // Draw angle arc
    if (options.showArc) {
      const arcRadius = (options.arcRadius ?? 40) * pixelRatio;
      const angle = Math.atan2(start.y - end.y, end.x - start.x);

      // Draw horizontal reference line (dashed)
      ctx.save();
      ctx.setLineDash([4 * pixelRatio, 4 * pixelRatio]);
      ctx.strokeStyle = this._drawing.style.lineColor + '80';
      ctx.lineWidth = 1 * pixelRatio;
      ctx.beginPath();
      ctx.moveTo(start.x * pixelRatio, start.y * pixelRatio);
      ctx.lineTo((start.x + arcRadius / pixelRatio + 20) * pixelRatio, start.y * pixelRatio);
      ctx.stroke();
      ctx.restore();

      // Draw arc
      ctx.beginPath();
      ctx.strokeStyle = this._drawing.style.lineColor;
      ctx.lineWidth = 2 * pixelRatio;

      // Arc from 0 (horizontal right) to the angle
      if (angle >= 0) {
        ctx.arc(start.x * pixelRatio, start.y * pixelRatio, arcRadius, 0, -angle, true);
      } else {
        ctx.arc(start.x * pixelRatio, start.y * pixelRatio, arcRadius, 0, -angle, false);
      }
      ctx.stroke();

      // Fill arc area with semi-transparent color
      ctx.beginPath();
      ctx.fillStyle = this._drawing.style.lineColor + '20';
      ctx.moveTo(start.x * pixelRatio, start.y * pixelRatio);
      if (angle >= 0) {
        ctx.arc(start.x * pixelRatio, start.y * pixelRatio, arcRadius, 0, -angle, true);
      } else {
        ctx.arc(start.x * pixelRatio, start.y * pixelRatio, arcRadius, 0, -angle, false);
      }
      ctx.closePath();
      ctx.fill();
    }

    // Draw angle label
    if (options.showDegrees) {
      const angleDeg = getLineAngleDegrees(start, end);
      const labelRadius = (options.arcRadius ?? 40) + 15;

      // Position label at the midpoint of the arc
      const midAngle = Math.atan2(start.y - end.y, end.x - start.x) / 2;
      const labelX = start.x + labelRadius * Math.cos(-midAngle);
      const labelY = start.y - labelRadius * Math.sin(-midAngle);

      drawLabel(
        ctx,
        `${angleDeg.toFixed(1)}°`,
        { x: labelX, y: labelY },
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
