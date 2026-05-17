import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { Signpost } from './signpost';
import { drawControlPoints } from '../../rendering/canvas-utils';

export class SignpostPaneView implements IPrimitivePaneView {
  private _renderer: SignpostPaneRenderer;

  constructor(drawing: Signpost) {
    this._renderer = new SignpostPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class SignpostPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: Signpost;

  constructor(drawing: Signpost) {
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

    const options = this._drawing.signpostOptions;
    const text = options.text ?? '';
    const fontSize = (options.fontSize ?? 11) * pixelRatio;
    const bgColor = options.backgroundColor ?? '#FF9800';
    const textColor = options.textColor ?? '#000000';
    const isRight = options.direction !== 'left';
    const arrowSize = 10 * pixelRatio;
    const padding = 8 * pixelRatio;
    const height = 24 * pixelRatio;
    const poleHeight = 30 * pixelRatio;

    const x = p.x * pixelRatio;
    const y = p.y * pixelRatio;

    ctx.save();

    // Measure text
    ctx.font = `bold ${fontSize}px sans-serif`;
    const textWidth = ctx.measureText(text).width;
    const bodyWidth = textWidth + padding * 2;

    // Draw pole
    ctx.strokeStyle = bgColor;
    ctx.lineWidth = 2 * pixelRatio;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - poleHeight - height);
    ctx.stroke();

    // Draw signpost body with arrow
    const signY = y - poleHeight - height;

    ctx.fillStyle = bgColor;
    ctx.beginPath();

    if (isRight) {
      ctx.moveTo(x, signY);
      ctx.lineTo(x + bodyWidth, signY);
      ctx.lineTo(x + bodyWidth + arrowSize, signY + height / 2);
      ctx.lineTo(x + bodyWidth, signY + height);
      ctx.lineTo(x, signY + height);
    } else {
      ctx.moveTo(x, signY);
      ctx.lineTo(x - bodyWidth, signY);
      ctx.lineTo(x - bodyWidth - arrowSize, signY + height / 2);
      ctx.lineTo(x - bodyWidth, signY + height);
      ctx.lineTo(x, signY + height);
    }

    ctx.closePath();
    ctx.fill();

    // Draw text
    ctx.fillStyle = textColor;
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textBaseline = 'middle';

    if (isRight) {
      ctx.textAlign = 'left';
      ctx.fillText(text, x + padding, signY + height / 2);
    } else {
      ctx.textAlign = 'right';
      ctx.fillText(text, x - padding, signY + height / 2);
    }

    // Draw base circle
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.arc(x, y, 3 * pixelRatio, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
