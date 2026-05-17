import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { Comment } from './comment';
import { drawControlPoints } from '../../rendering/canvas-utils';

export class CommentPaneView implements IPrimitivePaneView {
  private _renderer: CommentPaneRenderer;

  constructor(drawing: Comment) {
    this._renderer = new CommentPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class CommentPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: Comment;

  constructor(drawing: Comment) {
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

    const options = this._drawing.commentOptions;
    const text = options.text ?? '';
    const fontSize = (options.fontSize ?? 11) * pixelRatio;
    const bgColor = options.backgroundColor ?? '#2962FF';
    const textColor = options.textColor ?? '#FFFFFF';
    const padding = 8 * pixelRatio;
    const borderRadius = 6 * pixelRatio;
    const tailSize = 8 * pixelRatio;

    const x = p.x * pixelRatio;
    const y = p.y * pixelRatio;

    ctx.save();

    // Measure text
    ctx.font = `${fontSize}px sans-serif`;
    const lines = this.wrapText(ctx, text, 120 * pixelRatio);
    const lineHeight = fontSize * 1.3;
    const contentHeight = lines.length * lineHeight;
    const maxLineWidth = Math.max(...lines.map(l => ctx.measureText(l).width));
    const boxWidth = maxLineWidth + padding * 2;
    const boxHeight = contentHeight + padding * 2;

    // Position bubble above anchor
    const bubbleX = x;
    const bubbleY = y - tailSize - boxHeight;

    // Draw speech bubble
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.roundRect(bubbleX, bubbleY, boxWidth, boxHeight, borderRadius);
    ctx.fill();

    // Draw tail (triangle pointing down to anchor)
    ctx.beginPath();
    ctx.moveTo(bubbleX + 10 * pixelRatio, bubbleY + boxHeight);
    ctx.lineTo(x, y);
    ctx.lineTo(bubbleX + 20 * pixelRatio, bubbleY + boxHeight);
    ctx.closePath();
    ctx.fill();

    // Draw text
    ctx.fillStyle = textColor;
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], bubbleX + padding, bubbleY + padding + i * lineHeight);
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
}
