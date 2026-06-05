import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { GannSquare } from './gann-square';
import { GANN_SQUARE_DIVISIONS } from './gann-square';
import type { Point } from '../../core/types';
import { applyStyle, drawLine, drawRect, drawControlPoints } from '../../rendering/canvas-utils';

export class GannSquarePaneView implements IPrimitivePaneView {
  private _renderer: GannSquarePaneRenderer;

  constructor(drawing: GannSquare) {
    this._renderer = new GannSquarePaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class GannSquarePaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: GannSquare;

  constructor(drawing: GannSquare) {
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
    const center = this._drawing.anchorToPixel(anchors[0], viewport);

    if (!center) return;

    const options = this._drawing.gannOptions;
    const radius = this._drawing.getSquareRadius(viewport);
    const divisions = options.divisions ?? GANN_SQUARE_DIVISIONS;

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Draw fill if enabled
    if (options.filled && this._drawing.style.fillColor) {
      ctx.fillStyle = this._drawing.style.fillColor;
      ctx.fillRect(
        (center.x - radius) * pixelRatio,
        (center.y - radius) * pixelRatio,
        radius * 2 * pixelRatio,
        radius * 2 * pixelRatio
      );
    }

    // Draw outer square
    drawRect(ctx, { x: center.x - radius, y: center.y - radius }, radius * 2, radius * 2, false, pixelRatio);

    // Draw concentric squares
    ctx.globalAlpha = 0.4;
    for (let i = 1; i < divisions; i++) {
      const r = (radius * i) / divisions;
      drawRect(ctx, { x: center.x - r, y: center.y - r }, r * 2, r * 2, false, pixelRatio);
    }
    ctx.globalAlpha = 1;

    // Draw cardinal cross (horizontal and vertical through center)
    if (options.showCardinalCross) {
      ctx.globalAlpha = 0.8;
      drawLine(ctx, { x: center.x - radius, y: center.y }, { x: center.x + radius, y: center.y }, pixelRatio);
      drawLine(ctx, { x: center.x, y: center.y - radius }, { x: center.x, y: center.y + radius }, pixelRatio);
      ctx.globalAlpha = 1;
    }

    // Draw ordinal cross (diagonals)
    if (options.showDiagonals) {
      ctx.globalAlpha = 0.6;
      drawLine(
        ctx,
        { x: center.x - radius, y: center.y - radius },
        { x: center.x + radius, y: center.y + radius },
        pixelRatio
      );
      drawLine(
        ctx,
        { x: center.x - radius, y: center.y + radius },
        { x: center.x + radius, y: center.y - radius },
        pixelRatio
      );
      ctx.globalAlpha = 1;
    }

    // Draw spiral if enabled (Square of Nine pattern)
    if (options.showSpiral) {
      this.drawSpiral(ctx, center, radius, divisions, pixelRatio);
    }

    // Draw number labels if enabled
    if (options.showLabels) {
      this.drawNumberLabels(ctx, center, radius, divisions, pixelRatio);
    }

    // Draw center point marker
    ctx.beginPath();
    ctx.arc(center.x * pixelRatio, center.y * pixelRatio, 3 * pixelRatio, 0, Math.PI * 2);
    ctx.fill();

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }

  private drawSpiral(
    ctx: CanvasRenderingContext2D,
    center: Point,
    radius: number,
    _divisions: number,
    pixelRatio: number
  ): void {
    ctx.globalAlpha = 0.5;
    ctx.beginPath();

    const totalRotations = 3;
    const steps = 100;

    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * totalRotations * Math.PI * 2;
      const r = (t / (totalRotations * Math.PI * 2)) * radius;
      const x = center.x + r * Math.cos(t - Math.PI / 2);
      const y = center.y + r * Math.sin(t - Math.PI / 2);

      if (i === 0) {
        ctx.moveTo(x * pixelRatio, y * pixelRatio);
      } else {
        ctx.lineTo(x * pixelRatio, y * pixelRatio);
      }
    }

    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawNumberLabels(
    ctx: CanvasRenderingContext2D,
    center: Point,
    radius: number,
    divisions: number,
    pixelRatio: number
  ): void {
    const cellSize = radius / divisions;
    const fontSize = Math.max(8, Math.min(12, cellSize * 0.4));

    ctx.font = `${fontSize * pixelRatio}px sans-serif`;
    ctx.fillStyle = this._drawing.style.lineColor || '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Draw central 1
    ctx.fillText('1', center.x * pixelRatio, center.y * pixelRatio);

    // Draw numbers in spiral pattern (simplified)
    let num = 2;
    let layer = 1;
    const maxLayers = Math.min(divisions, 4); // Limit labels to prevent clutter

    while (layer <= maxLayers && num <= 81) {
      const offset = cellSize * layer;

      // Right side going up
      for (let i = -layer + 1; i <= layer && num <= 81; i++) {
        const x = center.x + offset;
        const y = center.y - cellSize * i;
        if (Math.abs(x - center.x) <= radius && Math.abs(y - center.y) <= radius) {
          ctx.fillText(String(num), x * pixelRatio, y * pixelRatio);
        }
        num++;
      }

      // Top going left
      for (let i = layer - 1; i >= -layer && num <= 81; i--) {
        const x = center.x + cellSize * i;
        const y = center.y - offset;
        if (Math.abs(x - center.x) <= radius && Math.abs(y - center.y) <= radius) {
          ctx.fillText(String(num), x * pixelRatio, y * pixelRatio);
        }
        num++;
      }

      // Left side going down
      for (let i = -layer + 1; i <= layer && num <= 81; i++) {
        const x = center.x - offset;
        const y = center.y + cellSize * i;
        if (Math.abs(x - center.x) <= radius && Math.abs(y - center.y) <= radius) {
          ctx.fillText(String(num), x * pixelRatio, y * pixelRatio);
        }
        num++;
      }

      // Bottom going right
      for (let i = -layer + 1; i <= layer && num <= 81; i++) {
        const x = center.x + cellSize * i;
        const y = center.y + offset;
        if (Math.abs(x - center.x) <= radius && Math.abs(y - center.y) <= radius) {
          ctx.fillText(String(num), x * pixelRatio, y * pixelRatio);
        }
        num++;
      }

      layer++;
    }
  }
}
