import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { FibExtension } from './fib-extension';
import { FIB_EXTENSION_LEVELS } from './fib-extension';
import { applyStyle, drawLine, drawControlPoints, drawLabel, drawDashedLine } from '../../rendering/canvas-utils';

const FIB_COLORS: Record<number, string> = {
  0: '#787B86',
  0.236: '#F7525F',
  0.382: '#FF9800',
  0.5: '#4CAF50',
  0.618: '#2196F3',
  0.786: '#9C27B0',
  1: '#787B86',
  1.272: '#00BCD4',
  1.618: '#E91E63',
  2: '#795548',
  2.618: '#607D8B',
  3.618: '#9E9E9E',
  4.236: '#FF5722',
};

export class FibExtensionPaneView implements IPrimitivePaneView {
  private _renderer: FibExtensionPaneRenderer;

  constructor(drawing: FibExtension) {
    this._renderer = new FibExtensionPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class FibExtensionPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: FibExtension;

  constructor(drawing: FibExtension) {
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

    const options = this._drawing.fibOptions;
    const levels = options.levels ?? FIB_EXTENSION_LEVELS;
    const priceA = anchors[0].price;
    const priceB = anchors[1].price;
    const priceC = anchors[2].price;
    const range = priceB - priceA;

    // Draw connecting lines A-B-C
    applyStyle(ctx, this._drawing.style, pixelRatio);
    drawDashedLine(ctx, pA, pB, [5, 5], pixelRatio);
    drawDashedLine(ctx, pB, pC, [5, 5], pixelRatio);

    // Draw extension levels
    for (const level of levels) {
      const price = priceC + range * level;
      const y = viewport.priceScale.priceToCoordinate(price);
      if (y === null) continue;

      const color = FIB_COLORS[level] ?? this._drawing.style.lineColor;
      ctx.strokeStyle = color;
      ctx.lineWidth = this._drawing.style.lineWidth * pixelRatio;

      const startX = options.extendLines ? 0 : pC.x;
      drawLine(ctx, { x: startX, y }, { x: viewport.width, y }, pixelRatio);

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
          { x: viewport.width - 5, y },
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

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
