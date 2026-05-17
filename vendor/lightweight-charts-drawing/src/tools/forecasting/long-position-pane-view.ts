import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { LongPosition } from './long-position';
import { drawLine, drawControlPoints } from '../../rendering/canvas-utils';

export class LongPositionPaneView implements IPrimitivePaneView {
  private _renderer: LongPositionPaneRenderer;

  constructor(drawing: LongPosition) {
    this._renderer = new LongPositionPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class LongPositionPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: LongPosition;

  constructor(drawing: LongPosition) {
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
    const entry = this._drawing.anchorToPixel(anchors[0], viewport);
    const stopLoss = this._drawing.anchorToPixel(anchors[1], viewport);
    const takeProfit = this._drawing.anchorToPixel(anchors[2], viewport);

    if (!entry || !stopLoss || !takeProfit) return;

    const options = this._drawing.positionOptions;
    const info = this._drawing.getPositionInfo();
    const width = 200;

    // Draw risk zone (entry to stop loss) - Red
    ctx.fillStyle = 'rgba(239, 83, 80, 0.3)';
    const riskTop = Math.min(entry.y, stopLoss.y);
    const riskHeight = Math.abs(stopLoss.y - entry.y);
    ctx.fillRect(entry.x * pixelRatio, riskTop * pixelRatio, width * pixelRatio, riskHeight * pixelRatio);

    // Draw risk zone border
    ctx.strokeStyle = '#ef5350';
    ctx.lineWidth = 1 * pixelRatio;
    ctx.strokeRect(entry.x * pixelRatio, riskTop * pixelRatio, width * pixelRatio, riskHeight * pixelRatio);

    // Draw reward zone (entry to take profit) - Green
    ctx.fillStyle = 'rgba(38, 166, 154, 0.3)';
    const rewardTop = Math.min(entry.y, takeProfit.y);
    const rewardHeight = Math.abs(takeProfit.y - entry.y);
    ctx.fillRect(entry.x * pixelRatio, rewardTop * pixelRatio, width * pixelRatio, rewardHeight * pixelRatio);

    // Draw reward zone border
    ctx.strokeStyle = '#26a69a';
    ctx.lineWidth = 1 * pixelRatio;
    ctx.strokeRect(entry.x * pixelRatio, rewardTop * pixelRatio, width * pixelRatio, rewardHeight * pixelRatio);

    // Draw entry line
    ctx.strokeStyle = '#2196F3';
    ctx.lineWidth = 2 * pixelRatio;
    drawLine(ctx, { x: entry.x, y: entry.y }, { x: entry.x + width, y: entry.y }, pixelRatio);

    // Draw stop loss line
    ctx.strokeStyle = '#ef5350';
    ctx.lineWidth = 2 * pixelRatio;
    ctx.setLineDash([5 * pixelRatio, 3 * pixelRatio]);
    drawLine(ctx, { x: entry.x, y: stopLoss.y }, { x: entry.x + width, y: stopLoss.y }, pixelRatio);

    // Draw take profit line
    ctx.strokeStyle = '#26a69a';
    drawLine(ctx, { x: entry.x, y: takeProfit.y }, { x: entry.x + width, y: takeProfit.y }, pixelRatio);
    ctx.setLineDash([]);

    // Draw labels
    const fontSize = 11;
    ctx.font = `${fontSize * pixelRatio}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const labelX = entry.x + width + 5;

    // Entry label
    ctx.fillStyle = '#2196F3';
    let entryText = 'Entry';
    if (options.showPrices) {
      entryText += `: $${info.entry.toFixed(2)}`;
    }
    ctx.fillText(entryText, labelX * pixelRatio, entry.y * pixelRatio);

    // Stop loss label
    ctx.fillStyle = '#ef5350';
    let slText = 'Stop';
    if (options.showPrices) {
      slText += `: $${info.stopLoss.toFixed(2)}`;
    }
    if (options.showPercentage) {
      slText += ` (-${info.riskPercent.toFixed(2)}%)`;
    }
    ctx.fillText(slText, labelX * pixelRatio, stopLoss.y * pixelRatio);

    // Take profit label
    ctx.fillStyle = '#26a69a';
    let tpText = 'Target';
    if (options.showPrices) {
      tpText += `: $${info.takeProfit.toFixed(2)}`;
    }
    if (options.showPercentage) {
      tpText += ` (+${info.rewardPercent.toFixed(2)}%)`;
    }
    ctx.fillText(tpText, labelX * pixelRatio, takeProfit.y * pixelRatio);

    // Risk/Reward ratio
    if (options.showRiskReward) {
      ctx.fillStyle = '#ffffff';
      const rrText = `R:R = 1:${info.riskRewardRatio.toFixed(2)}`;
      const rrY = (entry.y + takeProfit.y) / 2;
      ctx.fillText(rrText, (entry.x + 10) * pixelRatio, rrY * pixelRatio);
    }

    // Position type indicator
    ctx.fillStyle = '#26a69a';
    ctx.font = `bold ${14 * pixelRatio}px sans-serif`;
    ctx.fillText('LONG', (entry.x + 10) * pixelRatio, (entry.y - 15) * pixelRatio);

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
