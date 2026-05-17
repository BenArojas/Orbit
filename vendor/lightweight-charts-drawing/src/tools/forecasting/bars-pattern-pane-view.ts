import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { BarsPattern } from './bars-pattern';
import type { Point } from '../../core/types';
import { drawLine, drawControlPoints, drawDashedLine } from '../../rendering/canvas-utils';

export class BarsPatternPaneView implements IPrimitivePaneView {
  private _renderer: BarsPatternPaneRenderer;

  constructor(drawing: BarsPattern) {
    this._renderer = new BarsPatternPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class BarsPatternPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: BarsPattern;

  constructor(drawing: BarsPattern) {
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
    const pA = this._drawing.anchorToPixel(anchors[0], viewport);
    const pB = this._drawing.anchorToPixel(anchors[1], viewport);
    const pC = this._drawing.anchorToPixel(anchors[2], viewport);

    if (!pA || !pB || !pC) return;

    const options = this._drawing.barsPatternOptions;
    const lineColor = this._drawing.style.lineColor || '#FF9800';
    const patternColor = options.patternColor ?? '#FF9800';

    const dx = pB.x - pA.x;
    const dy = pB.y - pA.y;
    const pD: Point = { x: pC.x + dx, y: pC.y + dy };

    // Draw source pattern box
    if (options.filled) {
      const srcLeft = Math.min(pA.x, pB.x);
      const srcTop = Math.min(pA.y, pB.y);
      const srcW = Math.abs(pB.x - pA.x);
      const srcH = Math.abs(pB.y - pA.y);
      ctx.fillStyle = lineColor + '15';
      ctx.fillRect(srcLeft * pixelRatio, srcTop * pixelRatio, srcW * pixelRatio, srcH * pixelRatio);

      // Source border
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1 * pixelRatio;
      ctx.strokeRect(srcLeft * pixelRatio, srcTop * pixelRatio, srcW * pixelRatio, srcH * pixelRatio);
    }

    // Draw source diagonal
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2 * pixelRatio;
    drawLine(ctx, pA, pB, pixelRatio);

    // Draw projected pattern box
    if (options.filled) {
      const projLeft = Math.min(pC.x, pD.x);
      const projTop = Math.min(pC.y, pD.y);
      const projW = Math.abs(pD.x - pC.x);
      const projH = Math.abs(pD.y - pC.y);
      ctx.fillStyle = patternColor + '20';
      ctx.fillRect(projLeft * pixelRatio, projTop * pixelRatio, projW * pixelRatio, projH * pixelRatio);

      // Projected border
      ctx.strokeStyle = patternColor;
      ctx.lineWidth = 1 * pixelRatio;
      ctx.setLineDash([4 * pixelRatio, 3 * pixelRatio]);
      ctx.strokeRect(projLeft * pixelRatio, projTop * pixelRatio, projW * pixelRatio, projH * pixelRatio);
      ctx.setLineDash([]);
    }

    // Draw projected diagonal
    ctx.strokeStyle = patternColor;
    ctx.lineWidth = 2 * pixelRatio;
    drawLine(ctx, pC, pD, pixelRatio);

    // Draw connecting line B-C (dashed)
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1 * pixelRatio;
    ctx.globalAlpha = 0.5;
    drawDashedLine(ctx, pB, pC, [5, 3], pixelRatio);
    ctx.globalAlpha = 1;

    // Draw point markers
    const fontSize = 11;
    ctx.font = `bold ${fontSize * pixelRatio}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const points = [
      { point: pA, label: 'A', color: lineColor },
      { point: pB, label: 'B', color: lineColor },
      { point: pC, label: 'C', color: patternColor },
      { point: pD, label: 'D', color: patternColor },
    ];

    for (const { point, label, color } of points) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(point.x * pixelRatio, point.y * pixelRatio, 6 * pixelRatio, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, point.x * pixelRatio, point.y * pixelRatio);
    }

    // Draw labels
    if (options.showLabels) {
      ctx.font = `${fontSize * pixelRatio}px sans-serif`;
      ctx.fillStyle = lineColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('Source', ((pA.x + pB.x) / 2) * pixelRatio, (Math.min(pA.y, pB.y) - 8) * pixelRatio);

      ctx.fillStyle = patternColor;
      ctx.fillText('Pattern', ((pC.x + pD.x) / 2) * pixelRatio, (Math.min(pC.y, pD.y) - 8) * pixelRatio);
    }

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
