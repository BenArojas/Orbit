import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { AnchoredText } from './anchored-text';
import { drawControlPoints } from '../../rendering/canvas-utils';

export class AnchoredTextPaneView implements IPrimitivePaneView {
  private _renderer: AnchoredTextPaneRenderer;

  constructor(drawing: AnchoredText) {
    this._renderer = new AnchoredTextPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class AnchoredTextPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: AnchoredText;

  constructor(drawing: AnchoredText) {
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
    const anchorPos = this._drawing.anchorToPixel(anchors[0], viewport);
    const textPos = this._drawing.anchorToPixel(anchors[1], viewport);

    if (!anchorPos || !textPos) return;

    const options = this._drawing.textOptions;
    const style = this._drawing.style;
    const text = options.text ?? '';
    const fontSize = (options.fontSize ?? 12) * pixelRatio;
    const fontFamily = options.fontFamily ?? 'sans-serif';
    const fontWeight = options.fontWeight ?? 'normal';
    const padding = 6 * pixelRatio;

    ctx.save();

    // Draw connector line
    if (options.showConnector) {
      ctx.strokeStyle = style.lineColor;
      ctx.lineWidth = 1 * pixelRatio;
      ctx.beginPath();
      ctx.moveTo(anchorPos.x * pixelRatio, anchorPos.y * pixelRatio);
      ctx.lineTo(textPos.x * pixelRatio, textPos.y * pixelRatio);
      ctx.stroke();

      // Draw anchor point circle
      ctx.fillStyle = style.lineColor;
      ctx.beginPath();
      ctx.arc(anchorPos.x * pixelRatio, anchorPos.y * pixelRatio, 4 * pixelRatio, 0, Math.PI * 2);
      ctx.fill();
    }

    // Set up font
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.textAlign = options.textAlign ?? 'left';
    ctx.textBaseline = 'middle';

    // Measure text
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    const textHeight = fontSize;

    const x = textPos.x * pixelRatio;
    const y = textPos.y * pixelRatio;

    // Calculate box position based on alignment
    let boxX = x;
    if (options.textAlign === 'center') {
      boxX = x - textWidth / 2;
    } else if (options.textAlign === 'right') {
      boxX = x - textWidth;
    }

    // Draw text background
    ctx.fillStyle = 'rgba(30, 34, 45, 0.95)';
    ctx.beginPath();
    ctx.roundRect(
      boxX - padding,
      y - textHeight / 2 - padding,
      textWidth + padding * 2,
      textHeight + padding * 2,
      3 * pixelRatio
    );
    ctx.fill();

    // Draw border
    ctx.strokeStyle = style.lineColor;
    ctx.lineWidth = 1 * pixelRatio;
    ctx.stroke();

    // Draw text
    ctx.fillStyle = style.labelColor ?? '#FFFFFF';
    ctx.fillText(text, x, y);

    ctx.restore();

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
