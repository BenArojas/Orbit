import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { FibRetracement } from './fib-retracement';
import { FIBONACCI_LEVELS } from './fib-retracement';
import { applyStyle, drawLine, drawControlPoints, drawLabel } from '../../rendering/canvas-utils';

// Colors for different Fib levels
const FIB_COLORS: Record<number, string> = {
  0: '#787B86',
  0.236: '#F7525F',
  0.382: '#FF9800',
  0.5: '#4CAF50',
  0.618: '#2196F3',
  0.786: '#9C27B0',
  1: '#787B86',
  1.618: '#00BCD4',
  2.618: '#E91E63',
};

export class FibRetracementPaneView implements IPrimitivePaneView {
  private _renderer: FibRetracementPaneRenderer;

  constructor(drawing: FibRetracement) {
    this._renderer = new FibRetracementPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class FibRetracementPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: FibRetracement;

  constructor(drawing: FibRetracement) {
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
    const levels = options.levels ?? FIBONACCI_LEVELS;
    const price1 = anchors[0].price;
    const price2 = anchors[1].price;
    const priceRange = price2 - price1;

    const minX = options.extendLines ? 0 : Math.min(p1.x, p2.x);
    const maxX = options.extendLines ? viewport.width : Math.max(p1.x, p2.x);

    // Draw fill between levels
    if (this._drawing.style.fillColor) {
      const sortedLevels = [...levels].sort((a, b) => a - b);
      for (let i = 0; i < sortedLevels.length - 1; i++) {
        const level1 = sortedLevels[i];
        const level2 = sortedLevels[i + 1];

        const levelPrice1 = options.reverseDirection
          ? price2 - priceRange * level1
          : price1 + priceRange * level1;
        const levelPrice2 = options.reverseDirection
          ? price2 - priceRange * level2
          : price1 + priceRange * level2;

        const y1 = viewport.priceScale.priceToCoordinate(levelPrice1);
        const y2 = viewport.priceScale.priceToCoordinate(levelPrice2);

        if (y1 === null || y2 === null) continue;

        ctx.fillStyle = this._drawing.style.fillColor;
        ctx.globalAlpha = 0.1;
        ctx.fillRect(
          minX * pixelRatio,
          Math.min(y1, y2) * pixelRatio,
          (maxX - minX) * pixelRatio,
          Math.abs(y2 - y1) * pixelRatio
        );
        ctx.globalAlpha = 1;
      }
    }

    // Draw level lines
    for (const level of levels) {
      const price = options.reverseDirection
        ? price2 - priceRange * level
        : price1 + priceRange * level;

      const y = viewport.priceScale.priceToCoordinate(price);
      if (y === null) continue;

      // Use level-specific color or default
      const color = FIB_COLORS[level] ?? this._drawing.style.lineColor;
      ctx.strokeStyle = color;
      ctx.lineWidth = this._drawing.style.lineWidth * pixelRatio;

      drawLine(ctx, { x: minX, y }, { x: maxX, y }, pixelRatio);

      // Draw labels
      const labelParts: string[] = [];

      if (options.showPercentages) {
        labelParts.push(`${(level * 100).toFixed(1)}%`);
      }

      if (options.showPrices) {
        labelParts.push(price.toFixed(2));
      }

      if (labelParts.length > 0) {
        drawLabel(
          ctx,
          labelParts.join(' - '),
          { x: maxX - 5, y },
          {
            font: '11px sans-serif',
            textColor: '#ffffff',
            backgroundColor: color + 'CC',
            padding: 3,
            borderRadius: 2,
          },
          pixelRatio
        );
      }
    }

    // Draw the main trend line connecting anchors
    applyStyle(ctx, this._drawing.style, pixelRatio);
    ctx.setLineDash([5, 5]);
    drawLine(ctx, p1, p2, pixelRatio);
    ctx.setLineDash([]);

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
