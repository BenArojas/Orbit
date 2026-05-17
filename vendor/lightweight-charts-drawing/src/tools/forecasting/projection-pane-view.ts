import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { Projection } from './projection';
import type { Point } from '../../core/types';
import { drawLine, drawControlPoints, drawDashedLine } from '../../rendering/canvas-utils';

export class ProjectionPaneView implements IPrimitivePaneView {
  private _renderer: ProjectionPaneRenderer;

  constructor(drawing: Projection) {
    this._renderer = new ProjectionPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class ProjectionPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: Projection;

  constructor(drawing: Projection) {
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

    const options = this._drawing.projectionOptions;
    const info = this._drawing.getProjectionInfo();
    const lineColor = this._drawing.style.lineColor || '#9C27B0';

    // Calculate target point D
    const dy = pB.y - pA.y;
    const dx = pB.x - pA.x;
    const pD: Point = {
      x: pC.x + dx,
      y: pC.y + dy,
    };

    // Choose color based on direction
    const color = info.isUp ? '#26a69a' : '#ef5350';

    // Draw filled projection zone
    if (options.filled) {
      const left = Math.min(pC.x, pD.x);
      const top = Math.min(pC.y, pD.y);
      const width = Math.abs(pD.x - pC.x);
      const height = Math.abs(pD.y - pC.y);

      ctx.fillStyle = color + '20';
      ctx.fillRect(left * pixelRatio, top * pixelRatio, width * pixelRatio, height * pixelRatio);
    }

    // Draw reference line A-B
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2 * pixelRatio;
    drawLine(ctx, pA, pB, pixelRatio);

    // Draw projection line C-D
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * pixelRatio;
    drawLine(ctx, pC, pD, pixelRatio);

    // Draw connecting lines (dashed)
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1 * pixelRatio;
    ctx.globalAlpha = 0.5;
    drawDashedLine(ctx, pA, pC, [5, 3], pixelRatio);
    drawDashedLine(ctx, pB, pD, [5, 3], pixelRatio);
    ctx.globalAlpha = 1;

    // Draw point markers
    const points = [
      { point: pA, label: 'A' },
      { point: pB, label: 'B' },
      { point: pC, label: 'C' },
      { point: pD, label: 'D' },
    ];

    const fontSize = 11;
    ctx.font = `bold ${fontSize * pixelRatio}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const { point, label } of points) {
      // Draw circle
      ctx.fillStyle = label === 'D' ? color : lineColor;
      ctx.beginPath();
      ctx.arc(point.x * pixelRatio, point.y * pixelRatio, 6 * pixelRatio, 0, Math.PI * 2);
      ctx.fill();

      // Draw label
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, point.x * pixelRatio, point.y * pixelRatio);
    }

    // Draw info panel at target point D
    if (options.showLabels) {
      const panelX = pD.x + 15;
      const panelY = pD.y;
      const padding = 6;
      const lineHeight = fontSize + 3;

      const lines: string[] = [];

      if (options.showPrices) {
        lines.push(`Target: $${info.targetPrice.toFixed(2)}`);
      }

      if (options.showPercentage) {
        const sign = info.movePercent >= 0 ? '+' : '';
        lines.push(`Move: ${sign}${info.movePercent.toFixed(2)}%`);
      }

      if (lines.length > 0) {
        ctx.font = `${fontSize * pixelRatio}px sans-serif`;

        let maxWidth = 0;
        for (const line of lines) {
          const textWidth = ctx.measureText(line).width / pixelRatio;
          maxWidth = Math.max(maxWidth, textWidth);
        }

        const boxWidth = maxWidth + padding * 2;
        const boxHeight = lines.length * lineHeight + padding * 2;

        // Draw background
        ctx.fillStyle = '#1e222d';
        ctx.fillRect(
          panelX * pixelRatio,
          (panelY - boxHeight / 2) * pixelRatio,
          boxWidth * pixelRatio,
          boxHeight * pixelRatio
        );

        // Draw border
        ctx.strokeStyle = color;
        ctx.lineWidth = 1 * pixelRatio;
        ctx.strokeRect(
          panelX * pixelRatio,
          (panelY - boxHeight / 2) * pixelRatio,
          boxWidth * pixelRatio,
          boxHeight * pixelRatio
        );

        // Draw text
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        for (let i = 0; i < lines.length; i++) {
          const textY = panelY - boxHeight / 2 + padding + i * lineHeight;
          ctx.fillText(lines[i], (panelX + padding) * pixelRatio, textY * pixelRatio);
        }
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
