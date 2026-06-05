import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { Highlighter } from './highlighter';
import type { Point } from '../../core/types';
import { drawControlPoints } from '../../rendering/canvas-utils';

export class HighlighterPaneView implements IPrimitivePaneView {
  private _renderer: HighlighterPaneRenderer;

  constructor(drawing: Highlighter) {
    this._renderer = new HighlighterPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'bottom';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class HighlighterPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: Highlighter;

  constructor(drawing: Highlighter) {
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

    const options = this._drawing.highlighterOptions;
    const highlighterWidth = options.highlighterWidth ?? 20;
    const opacity = options.opacity ?? 0.4;

    // Get all points
    const points: Point[] = [];
    for (const anchor of this._drawing.anchors) {
      const p = this._drawing.anchorToPixel(anchor, viewport);
      if (p) points.push(p);
    }

    if (points.length < 2) return;

    // Draw the highlighter stroke
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = this._drawing.style.lineColor || '#FFEB3B';
    ctx.lineWidth = highlighterWidth * pixelRatio;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(points[0].x * pixelRatio, points[0].y * pixelRatio);

    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x * pixelRatio, points[i].y * pixelRatio);
    }

    ctx.stroke();
    ctx.restore();

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
