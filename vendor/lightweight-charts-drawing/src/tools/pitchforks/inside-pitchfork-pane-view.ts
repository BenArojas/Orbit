import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { InsidePitchfork } from './inside-pitchfork';
import { midpoint, extendLineToViewport } from '../../core/geometry';
import { applyStyle, drawLine, drawControlPoints, drawDashedLine } from '../../rendering/canvas-utils';

export class InsidePitchforkPaneView implements IPrimitivePaneView {
  private _renderer: InsidePitchforkPaneRenderer;

  constructor(drawing: InsidePitchfork) {
    this._renderer = new InsidePitchforkPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class InsidePitchforkPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: InsidePitchfork;

  constructor(drawing: InsidePitchfork) {
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

    const options = this._drawing.pitchforkOptions;
    const mid = midpoint(p1, p2);

    // Direction vector for median
    const dx = mid.x - p0.x;
    const dy = mid.y - p0.y;

    // Convergence point
    const convergencePoint = this._drawing.getConvergencePoint(p0, mid, 3);

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Calculate extended endpoints
    const medianEnd = { x: p0.x + dx * 3, y: p0.y + dy * 3 };

    // Extend if needed
    let drawMedianEnd = medianEnd;
    let drawConvergence = convergencePoint;

    if (options.extendLines) {
      const extMedian = extendLineToViewport(p0, medianEnd, viewport.width, viewport.height, false, true);
      drawMedianEnd = extMedian.end;

      // Extend converging lines beyond convergence point
      const extP1 = extendLineToViewport(p1, convergencePoint, viewport.width, viewport.height, false, true);
      const extP2 = extendLineToViewport(p2, convergencePoint, viewport.width, viewport.height, false, true);
      // Use the furthest extended point
      drawConvergence = {
        x: Math.max(extP1.end.x, extP2.end.x, convergencePoint.x),
        y: (extP1.end.y + extP2.end.y) / 2,
      };
    }

    // Draw fill if enabled
    if (options.filled && this._drawing.style.fillColor) {
      ctx.fillStyle = this._drawing.style.fillColor;
      ctx.beginPath();
      ctx.moveTo(p1.x * pixelRatio, p1.y * pixelRatio);
      ctx.lineTo(drawConvergence.x * pixelRatio, drawConvergence.y * pixelRatio);
      ctx.lineTo(p2.x * pixelRatio, p2.y * pixelRatio);
      ctx.closePath();
      ctx.fill();
    }

    // Draw median line
    if (options.showMedianLine) {
      drawDashedLine(ctx, p0, drawMedianEnd, [5, 5], pixelRatio);
    }

    // Draw converging outer lines
    if (options.showOuterLines) {
      // The lines converge, so we draw from swing points toward convergence
      if (options.extendLines) {
        // Extend lines beyond convergence
        const ext1 = extendLineToViewport(p1, convergencePoint, viewport.width, viewport.height, false, true);
        const ext2 = extendLineToViewport(p2, convergencePoint, viewport.width, viewport.height, false, true);
        drawLine(ctx, p1, ext1.end, pixelRatio);
        drawLine(ctx, p2, ext2.end, pixelRatio);
      } else {
        drawLine(ctx, p1, convergencePoint, pixelRatio);
        drawLine(ctx, p2, convergencePoint, pixelRatio);
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
