import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { Pitchfan } from './pitchfan';
import { PITCHFAN_LEVELS } from './pitchfan';
import { midpoint, extendLineToViewport } from '../../core/geometry';
import { applyStyle, drawLine, drawControlPoints, drawDashedLine, drawText } from '../../rendering/canvas-utils';

export class PitchfanPaneView implements IPrimitivePaneView {
  private _renderer: PitchfanPaneRenderer;

  constructor(drawing: Pitchfan) {
    this._renderer = new PitchfanPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class PitchfanPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: Pitchfan;

  constructor(drawing: Pitchfan) {
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
    const p0 = this._drawing.anchorToPixel(anchors[0], viewport);
    const p1 = this._drawing.anchorToPixel(anchors[1], viewport);
    const p2 = this._drawing.anchorToPixel(anchors[2], viewport);

    if (!p0 || !p1 || !p2) return;

    const options = this._drawing.fibOptions;
    const levels = options.levels ?? PITCHFAN_LEVELS;
    const mid = midpoint(p1, p2);

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Draw fill between fan lines if enabled
    if (options.filled && this._drawing.style.fillColor) {
      ctx.fillStyle = this._drawing.style.fillColor;
      const sortedLevels = [...levels].sort((a, b) => a - b);

      for (let i = 0; i < sortedLevels.length - 1; i++) {
        const end1 = this._drawing.getFanLineEnd(p0, p1, p2, sortedLevels[i]);
        const end2 = this._drawing.getFanLineEnd(p0, p1, p2, sortedLevels[i + 1]);

        ctx.beginPath();
        ctx.moveTo(p0.x * pixelRatio, p0.y * pixelRatio);
        ctx.lineTo(end1.x * pixelRatio, end1.y * pixelRatio);
        ctx.lineTo(end2.x * pixelRatio, end2.y * pixelRatio);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Draw median line
    const dx = mid.x - p0.x;
    const dy = mid.y - p0.y;
    let medianEnd = { x: p0.x + dx * 3, y: p0.y + dy * 3 };

    if (options.extendLines) {
      const extended = extendLineToViewport(p0, medianEnd, viewport.width, viewport.height, false, true);
      medianEnd = extended.end;
    }

    drawDashedLine(ctx, p0, medianEnd, [5, 5], pixelRatio);

    // Draw fan lines
    for (const level of levels) {
      let end = this._drawing.getFanLineEnd(p0, p1, p2, level);

      if (options.extendLines) {
        const extended = extendLineToViewport(p0, end, viewport.width, viewport.height, false, true);
        end = extended.end;
      }

      const isMainLevel = level === 0.382 || level === 0.5 || level === 0.618;
      ctx.globalAlpha = isMainLevel ? 1 : 0.6;
      drawLine(ctx, p0, end, pixelRatio);
      ctx.globalAlpha = 1;

      // Draw label
      if (options.showLabels) {
        const labelPos = {
          x: (p0.x + end.x) / 2,
          y: (p0.y + end.y) / 2,
        };
        const text = `${(level * 100).toFixed(1)}%`;
        drawText(ctx, text, labelPos, '10px sans-serif', this._drawing.style.lineColor || '#fff', 'left', 'middle', pixelRatio);
      }
    }

    // Draw connecting lines to anchors
    ctx.globalAlpha = 0.5;
    drawLine(ctx, p0, p1, pixelRatio);
    drawLine(ctx, p0, p2, pixelRatio);
    drawLine(ctx, p1, p2, pixelRatio);
    ctx.globalAlpha = 1;

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
