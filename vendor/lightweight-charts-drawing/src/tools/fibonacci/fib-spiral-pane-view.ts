import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { FibSpiral } from './fib-spiral';
import { GOLDEN_RATIO } from './fib-spiral';
import type { Point } from '../../core/types';
import { distanceBetweenPoints } from '../../core/geometry';
import { applyStyle, drawControlPoints } from '../../rendering/canvas-utils';

export class FibSpiralPaneView implements IPrimitivePaneView {
  private _renderer: FibSpiralPaneRenderer;

  constructor(drawing: FibSpiral) {
    this._renderer = new FibSpiralPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class FibSpiralPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: FibSpiral;

  constructor(drawing: FibSpiral) {
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
    const p1 = this._drawing.anchorToPixel(anchors[0], viewport); // Center
    const p2 = this._drawing.anchorToPixel(anchors[1], viewport); // Size reference

    if (!p1 || !p2) return;

    const options = this._drawing.fibOptions;
    const startRadius = distanceBetweenPoints(p1, p2) / GOLDEN_RATIO;

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Get spiral points
    const spiralPoints = this._drawing.getSpiralPoints(
      p1,
      startRadius,
      options.rotations ?? 4,
      options.clockwise ?? true
    );

    // Draw optional Fibonacci squares
    if (options.showSquares) {
      this.drawFibSquares(ctx, p1, startRadius, options.clockwise ?? true, pixelRatio);
    }

    // Draw spiral
    if (spiralPoints.length > 1) {
      ctx.beginPath();
      ctx.moveTo(spiralPoints[0].x * pixelRatio, spiralPoints[0].y * pixelRatio);

      for (let i = 1; i < spiralPoints.length; i++) {
        ctx.lineTo(spiralPoints[i].x * pixelRatio, spiralPoints[i].y * pixelRatio);
      }

      ctx.stroke();
    }

    // Draw radius line
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(p1.x * pixelRatio, p1.y * pixelRatio);
    ctx.lineTo(p2.x * pixelRatio, p2.y * pixelRatio);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }

  private drawFibSquares(
    ctx: CanvasRenderingContext2D,
    center: Point,
    startSize: number,
    _clockwise: boolean,
    pixelRatio: number
  ): void {
    ctx.globalAlpha = 0.3;

    // Draw Fibonacci sequence squares
    const fibSizes = [1, 1, 2, 3, 5, 8];
    let x = center.x;
    let y = center.y;
    const scale = startSize / 8; // Normalize to largest Fibonacci number

    for (let i = 0; i < fibSizes.length; i++) {
      const size = fibSizes[i] * scale;
      ctx.strokeRect(
        x * pixelRatio,
        y * pixelRatio,
        size * pixelRatio,
        size * pixelRatio
      );

      // Move to next position (simplified spiral layout)
      if (i % 4 === 0) x += size;
      else if (i % 4 === 1) y += size;
      else if (i % 4 === 2) x -= size;
      else y -= size;
    }

    ctx.globalAlpha = 1;
  }
}
