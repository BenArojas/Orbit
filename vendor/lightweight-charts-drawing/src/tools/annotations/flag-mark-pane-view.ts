import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { FlagMark } from './flag-mark';
import { drawControlPoints } from '../../rendering/canvas-utils';

export class FlagMarkPaneView implements IPrimitivePaneView {
  private _renderer: FlagMarkPaneRenderer;

  constructor(drawing: FlagMark) {
    this._renderer = new FlagMarkPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class FlagMarkPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: FlagMark;

  constructor(drawing: FlagMark) {
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

    const options = this._drawing.flagOptions;
    const color = this._drawing.getFlagColor();
    const size = (options.size ?? 20) * pixelRatio;
    const poleHeight = size * 1.5;
    const flagWidth = size;
    const flagHeight = size * 0.6;

    const x = p.x * pixelRatio;
    const y = p.y * pixelRatio;

    ctx.save();

    // Draw pole
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * pixelRatio;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - poleHeight);
    ctx.stroke();

    // Draw flag
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - poleHeight);
    ctx.lineTo(x + flagWidth, y - poleHeight + flagHeight / 2);
    ctx.lineTo(x, y - poleHeight + flagHeight);
    ctx.closePath();
    ctx.fill();

    // Draw base circle
    ctx.beginPath();
    ctx.arc(x, y, 3 * pixelRatio, 0, Math.PI * 2);
    ctx.fill();

    // Draw label if present
    const label = options.label;
    if (label) {
      const fontSize = 10 * pixelRatio;
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Draw label background
      const textMetrics = ctx.measureText(label);
      const labelPadding = 3 * pixelRatio;
      const labelWidth = textMetrics.width + labelPadding * 2;
      const labelHeight = fontSize + labelPadding * 2;
      const labelX = x + flagWidth / 2;
      const labelY = y - poleHeight - labelHeight / 2 - 2 * pixelRatio;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.beginPath();
      ctx.roundRect(
        labelX - labelWidth / 2,
        labelY - labelHeight / 2,
        labelWidth,
        labelHeight,
        2 * pixelRatio
      );
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(label, labelX, labelY);
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
