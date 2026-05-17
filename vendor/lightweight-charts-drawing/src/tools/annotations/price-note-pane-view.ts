import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { PriceNote } from './price-note';
import { drawControlPoints } from '../../rendering/canvas-utils';

export class PriceNotePaneView implements IPrimitivePaneView {
  private _renderer: PriceNotePaneRenderer;

  constructor(drawing: PriceNote) {
    this._renderer = new PriceNotePaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class PriceNotePaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: PriceNote;

  constructor(drawing: PriceNote) {
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

    const options = this._drawing.noteOptions;
    const fontSize = (options.fontSize ?? 11) * pixelRatio;
    const backgroundColor = options.backgroundColor ?? 'rgba(30, 34, 45, 0.95)';
    const priceColor = options.priceColor ?? '#26a69a';
    const noteColor = options.noteColor ?? '#d1d4dc';
    const padding = 6 * pixelRatio;
    const markerSize = 6 * pixelRatio;

    const x = p.x * pixelRatio;
    const y = p.y * pixelRatio;

    ctx.save();

    // Build content
    const lines: { text: string; color: string }[] = [];

    if (options.showPrice) {
      lines.push({ text: `$${anchor.price.toFixed(2)}`, color: priceColor });
    }

    if (options.note) {
      lines.push({ text: options.note, color: noteColor });
    }

    if (lines.length === 0) {
      lines.push({ text: `$${anchor.price.toFixed(2)}`, color: priceColor });
    }

    // Measure content
    ctx.font = `${fontSize}px sans-serif`;
    let maxWidth = 0;
    for (const line of lines) {
      const metrics = ctx.measureText(line.text);
      maxWidth = Math.max(maxWidth, metrics.width);
    }

    const lineHeight = fontSize * 1.3;
    const boxWidth = maxWidth + padding * 2 + markerSize + padding;
    const boxHeight = lines.length * lineHeight + padding * 2;

    // Draw marker
    ctx.fillStyle = priceColor;
    ctx.beginPath();
    ctx.arc(x, y, markerSize / 2, 0, Math.PI * 2);
    ctx.fill();

    // Draw connector line
    ctx.strokeStyle = priceColor;
    ctx.lineWidth = 1 * pixelRatio;
    ctx.beginPath();
    ctx.moveTo(x + markerSize / 2, y);
    ctx.lineTo(x + markerSize + padding / 2, y);
    ctx.stroke();

    // Draw box
    const boxX = x + markerSize + padding;
    const boxY = y - boxHeight / 2;

    ctx.fillStyle = backgroundColor;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 3 * pixelRatio);
    ctx.fill();

    ctx.strokeStyle = priceColor;
    ctx.lineWidth = 1 * pixelRatio;
    ctx.stroke();

    // Draw text
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < lines.length; i++) {
      ctx.fillStyle = lines[i].color;
      ctx.font = i === 0 ? `bold ${fontSize}px sans-serif` : `${fontSize}px sans-serif`;
      ctx.fillText(
        lines[i].text,
        boxX + padding,
        boxY + padding + lineHeight * (i + 0.5)
      );
    }

    ctx.restore();

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
