import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { Callout } from './callout';
import { drawControlPoints, drawLine } from '../../rendering/canvas-utils';

export class CalloutPaneView implements IPrimitivePaneView {
  private _renderer: CalloutPaneRenderer;

  constructor(drawing: Callout) {
    this._renderer = new CalloutPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class CalloutPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: Callout;

  constructor(drawing: Callout) {
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
    const target = this._drawing.anchorToPixel(anchors[0], viewport);
    const boxPos = this._drawing.anchorToPixel(anchors[1], viewport);

    if (!target || !boxPos) return;

    const options = this._drawing.calloutOptions;
    const text = options.text ?? '';
    const fontSize = (options.fontSize ?? 12) * pixelRatio;
    const fontFamily = options.fontFamily ?? 'sans-serif';
    const padding = (options.padding ?? 8) * pixelRatio;

    // Set up font
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Measure text
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    const textHeight = fontSize;

    const boxX = boxPos.x * pixelRatio;
    const boxY = boxPos.y * pixelRatio;
    const targetX = target.x * pixelRatio;
    const targetY = target.y * pixelRatio;

    const boxWidth = textWidth + padding * 2;
    const boxHeight = textHeight + padding * 2;

    // Draw pointer line
    ctx.strokeStyle = options.borderColor ?? '#FFC107';
    ctx.lineWidth = 2 * pixelRatio;
    drawLine(ctx,
      { x: target.x, y: target.y },
      { x: boxPos.x, y: boxPos.y },
      pixelRatio
    );

    // Draw target dot
    ctx.fillStyle = options.borderColor ?? '#FFC107';
    ctx.beginPath();
    ctx.arc(targetX, targetY, 4 * pixelRatio, 0, Math.PI * 2);
    ctx.fill();

    // Draw box background
    ctx.fillStyle = options.backgroundColor ?? 'rgba(255, 255, 200, 0.95)';
    ctx.beginPath();
    ctx.roundRect(
      boxX - padding,
      boxY - boxHeight / 2,
      boxWidth,
      boxHeight,
      4 * pixelRatio
    );
    ctx.fill();

    // Draw box border
    ctx.strokeStyle = options.borderColor ?? '#FFC107';
    ctx.lineWidth = 1 * pixelRatio;
    ctx.stroke();

    // Draw text
    ctx.fillStyle = this._drawing.style.labelColor ?? '#000000';
    ctx.fillText(text, boxX, boxY);

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
