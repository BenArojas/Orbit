import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { Note } from './note';
import { drawControlPoints } from '../../rendering/canvas-utils';

export class NotePaneView implements IPrimitivePaneView {
  private _renderer: NotePaneRenderer;

  constructor(drawing: Note) {
    this._renderer = new NotePaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class NotePaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: Note;

  constructor(drawing: Note) {
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
    const text = options.text ?? '';
    const fontSize = (options.fontSize ?? 11) * pixelRatio;
    const backgroundColor = options.backgroundColor ?? '#FFEB3B';
    const iconColor = options.iconColor ?? '#000000';
    const width = (options.width ?? 120) * pixelRatio;
    const padding = 8 * pixelRatio;
    const iconSize = 16 * pixelRatio;

    const x = p.x * pixelRatio;
    const y = p.y * pixelRatio;

    ctx.save();

    // Calculate text wrapping
    ctx.font = `${fontSize}px sans-serif`;
    const lines = this.wrapText(ctx, text, width - padding * 2 - (options.showIcon ? iconSize + padding : 0));
    const lineHeight = fontSize * 1.3;
    const contentHeight = Math.max(lines.length * lineHeight, iconSize);
    const totalHeight = contentHeight + padding * 2;

    // Draw note background with folded corner effect
    ctx.fillStyle = backgroundColor;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width - 10 * pixelRatio, y);
    ctx.lineTo(x + width, y + 10 * pixelRatio);
    ctx.lineTo(x + width, y + totalHeight);
    ctx.lineTo(x, y + totalHeight);
    ctx.closePath();
    ctx.fill();

    // Draw folded corner
    ctx.fillStyle = this.darkenColor(backgroundColor, 0.2);
    ctx.beginPath();
    ctx.moveTo(x + width - 10 * pixelRatio, y);
    ctx.lineTo(x + width - 10 * pixelRatio, y + 10 * pixelRatio);
    ctx.lineTo(x + width, y + 10 * pixelRatio);
    ctx.closePath();
    ctx.fill();

    // Draw border
    ctx.strokeStyle = this.darkenColor(backgroundColor, 0.3);
    ctx.lineWidth = 1 * pixelRatio;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width - 10 * pixelRatio, y);
    ctx.lineTo(x + width, y + 10 * pixelRatio);
    ctx.lineTo(x + width, y + totalHeight);
    ctx.lineTo(x, y + totalHeight);
    ctx.closePath();
    ctx.stroke();

    // Draw icon if enabled
    let textX = x + padding;
    if (options.showIcon) {
      ctx.fillStyle = iconColor;
      ctx.font = `bold ${iconSize}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('📝', x + padding, y + padding);
      textX = x + padding + iconSize + padding / 2;
    }

    // Draw text
    ctx.fillStyle = iconColor;
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], textX, y + padding + i * lineHeight);
    }

    ctx.restore();

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }

  private wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.length > 0 ? lines : [''];
  }

  private darkenColor(hex: string, amount: number): string {
    // Convert hex to RGB
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);

    // Darken
    r = Math.floor(r * (1 - amount));
    g = Math.floor(g * (1 - amount));
    b = Math.floor(b * (1 - amount));

    // Convert back to hex
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
}
