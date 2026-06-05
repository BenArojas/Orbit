import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { DisjointChannel } from './disjoint-channel';
import { extendLineToViewport } from '../../core/geometry';
import { applyStyle, drawLine, drawControlPoints, drawDashedLine } from '../../rendering/canvas-utils';

export class DisjointChannelPaneView implements IPrimitivePaneView {
  private _renderer: DisjointChannelPaneRenderer;

  constructor(drawing: DisjointChannel) {
    this._renderer = new DisjointChannelPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class DisjointChannelPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: DisjointChannel;

  constructor(drawing: DisjointChannel) {
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
    const p1 = this._drawing.anchorToPixel(anchors[0], viewport);
    const p2 = this._drawing.anchorToPixel(anchors[1], viewport);
    const p3 = this._drawing.anchorToPixel(anchors[2], viewport);
    const p4 = this._drawing.anchorToPixel(anchors[3], viewport);

    if (!p1 || !p2 || !p3 || !p4) return;

    const options = this._drawing.channelOptions;

    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Handle extensions
    let drawP1 = p1, drawP2 = p2;
    let drawP3 = p3, drawP4 = p4;

    if (options.extendLines) {
      const extended1 = extendLineToViewport(p1, p2, viewport.width, viewport.height, true, true);
      const extended2 = extendLineToViewport(p3, p4, viewport.width, viewport.height, true, true);
      drawP1 = extended1.start;
      drawP2 = extended1.end;
      drawP3 = extended2.start;
      drawP4 = extended2.end;
    }

    // Draw fill if enabled
    if (options.filled && this._drawing.style.fillColor) {
      ctx.fillStyle = this._drawing.style.fillColor;
      ctx.beginPath();
      ctx.moveTo(drawP1.x * pixelRatio, drawP1.y * pixelRatio);
      ctx.lineTo(drawP2.x * pixelRatio, drawP2.y * pixelRatio);
      ctx.lineTo(drawP4.x * pixelRatio, drawP4.y * pixelRatio);
      ctx.lineTo(drawP3.x * pixelRatio, drawP3.y * pixelRatio);
      ctx.closePath();
      ctx.fill();
    }

    // Draw first line
    drawLine(ctx, drawP1, drawP2, pixelRatio);

    // Draw second line
    drawLine(ctx, drawP3, drawP4, pixelRatio);

    // Draw middle line if enabled
    if (options.showMiddleLine) {
      const midStart = {
        x: (p1.x + p3.x) / 2,
        y: (p1.y + p3.y) / 2,
      };
      const midEnd = {
        x: (p2.x + p4.x) / 2,
        y: (p2.y + p4.y) / 2,
      };

      let drawMidStart = midStart, drawMidEnd = midEnd;
      if (options.extendLines) {
        const extendedMid = extendLineToViewport(midStart, midEnd, viewport.width, viewport.height, true, true);
        drawMidStart = extendedMid.start;
        drawMidEnd = extendedMid.end;
      }

      drawDashedLine(ctx, drawMidStart, drawMidEnd, [5, 5], pixelRatio);
    }

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
