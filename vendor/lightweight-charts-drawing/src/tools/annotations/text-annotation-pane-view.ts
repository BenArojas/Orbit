import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { TextAnnotation } from './text-annotation';
import { drawControlPoints } from '../../rendering/canvas-utils';

export class TextAnnotationPaneView implements IPrimitivePaneView {
  private _renderer: TextAnnotationPaneRenderer;

  constructor(drawing: TextAnnotation) {
    this._renderer = new TextAnnotationPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class TextAnnotationPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: TextAnnotation;

  constructor(drawing: TextAnnotation) {
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

    const anchor = this._drawing.anchors[0];
    const p = this._drawing.anchorToPixel(anchor, viewport);
    if (!p) return;

    const options = this._drawing.textOptions;
    const text = options.text ?? '';
    const fontSize = (options.fontSize ?? 14) * pixelRatio;
    const fontFamily = options.fontFamily ?? 'sans-serif';
    const fontWeight = options.fontWeight ?? 'normal';
    const padding = (options.padding ?? 8) * pixelRatio;

    // Set up font
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.textAlign = options.textAlign ?? 'left';
    ctx.textBaseline = 'middle';

    // Measure text
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    const textHeight = fontSize;

    const x = p.x * pixelRatio;
    const y = p.y * pixelRatio;

    // Calculate box position based on alignment
    let boxX = x;
    if (options.textAlign === 'center') {
      boxX = x - textWidth / 2;
    } else if (options.textAlign === 'right') {
      boxX = x - textWidth;
    }

    // Draw background
    if (options.backgroundColor) {
      ctx.fillStyle = options.backgroundColor;
      ctx.beginPath();
      ctx.roundRect(
        boxX - padding,
        y - textHeight / 2 - padding,
        textWidth + padding * 2,
        textHeight + padding * 2,
        4 * pixelRatio
      );
      ctx.fill();
    }

    // Draw border
    if (options.borderColor) {
      ctx.strokeStyle = options.borderColor;
      ctx.lineWidth = 1 * pixelRatio;
      ctx.beginPath();
      ctx.roundRect(
        boxX - padding,
        y - textHeight / 2 - padding,
        textWidth + padding * 2,
        textHeight + padding * 2,
        4 * pixelRatio
      );
      ctx.stroke();
    }

    // Draw text
    ctx.fillStyle = this._drawing.style.labelColor ?? '#000000';
    ctx.fillText(text, x, y);

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
