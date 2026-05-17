import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { ModifiedSchiffPitchfork } from './modified-schiff-pitchfork';
import { midpoint, extendLineToViewport } from '../../core/geometry';
import { applyStyle, drawLine, drawControlPoints, drawDashedLine } from '../../rendering/canvas-utils';

export class ModifiedSchiffPitchforkPaneView implements IPrimitivePaneView {
  private _renderer: ModifiedSchiffPitchforkPaneRenderer;

  constructor(drawing: ModifiedSchiffPitchfork) {
    this._renderer = new ModifiedSchiffPitchforkPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class ModifiedSchiffPitchforkPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: ModifiedSchiffPitchfork;

  constructor(drawing: ModifiedSchiffPitchfork) {
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

    // Modified Schiff pivot
    const modifiedPivot = this._drawing.getModifiedSchiffPivot(p0, p1);
    const mid = midpoint(p1, p2);

    // Direction vector
    const dx = mid.x - modifiedPivot.x;
    const dy = mid.y - modifiedPivot.y;

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Calculate extended endpoints
    const medianEnd = { x: modifiedPivot.x + dx * 3, y: modifiedPivot.y + dy * 3 };
    const p1End = { x: p1.x + dx * 3, y: p1.y + dy * 3 };
    const p2End = { x: p2.x + dx * 3, y: p2.y + dy * 3 };

    // Extend if needed
    let drawMedianEnd = medianEnd;
    let drawP1End = p1End;
    let drawP2End = p2End;

    if (options.extendLines) {
      const extMedian = extendLineToViewport(modifiedPivot, medianEnd, viewport.width, viewport.height, false, true);
      const extP1 = extendLineToViewport(p1, p1End, viewport.width, viewport.height, false, true);
      const extP2 = extendLineToViewport(p2, p2End, viewport.width, viewport.height, false, true);
      drawMedianEnd = extMedian.end;
      drawP1End = extP1.end;
      drawP2End = extP2.end;
    }

    // Draw fill if enabled
    if (options.filled && this._drawing.style.fillColor) {
      ctx.fillStyle = this._drawing.style.fillColor;
      ctx.beginPath();
      ctx.moveTo(p1.x * pixelRatio, p1.y * pixelRatio);
      ctx.lineTo(drawP1End.x * pixelRatio, drawP1End.y * pixelRatio);
      ctx.lineTo(drawP2End.x * pixelRatio, drawP2End.y * pixelRatio);
      ctx.lineTo(p2.x * pixelRatio, p2.y * pixelRatio);
      ctx.closePath();
      ctx.fill();
    }

    // Draw median line
    if (options.showMedianLine) {
      drawDashedLine(ctx, modifiedPivot, drawMedianEnd, [5, 5], pixelRatio);
    }

    // Draw outer lines
    if (options.showOuterLines) {
      drawLine(ctx, p1, drawP1End, pixelRatio);
      drawLine(ctx, p2, drawP2End, pixelRatio);
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
