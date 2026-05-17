import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, RectangleGeometry } from '../../core/geometry';
import { LongPositionPaneView } from './long-position-pane-view';

/**
 * LongPosition options
 */
export interface LongPositionOptions extends DrawingOptions {
  showPrices?: boolean;
  showPercentage?: boolean;
  showRiskReward?: boolean;
  showPnL?: boolean;
  quantity?: number;
  accountSize?: number;
}

/**
 * LongPosition - Trade visualization for long positions.
 *
 * Features:
 * - Three anchor points: entry, stop loss, take profit
 * - Shows risk (red) and reward (green) zones
 * - Displays P&L, percentage change, and risk/reward ratio
 */
export class LongPosition extends Drawing {
  readonly type = 'long-position';

  protected static readonly REQUIRED_ANCHORS = 3;
  protected static readonly HIT_THRESHOLD = 5;

  private _positionOptions: LongPositionOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<LongPositionOptions> = {}
  ) {
    const { showPrices, showPercentage, showRiskReward, showPnL, quantity, accountSize, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._positionOptions = {
      ...this._options,
      showPrices: showPrices ?? true,
      showPercentage: showPercentage ?? true,
      showRiskReward: showRiskReward ?? true,
      showPnL: showPnL ?? true,
      quantity: quantity ?? 1,
      accountSize: accountSize ?? 10000,
    };
  }

  get positionOptions(): LongPositionOptions {
    return this._positionOptions;
  }

  setPositionOptions(options: Partial<LongPositionOptions>): void {
    this._positionOptions = { ...this._positionOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= LongPosition.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new LongPositionPaneView(this)];
  }

  /**
   * Get position info
   * Anchors: [0] = entry, [1] = stop loss, [2] = take profit
   */
  getPositionInfo(): {
    entry: number;
    stopLoss: number;
    takeProfit: number;
    risk: number;
    reward: number;
    riskRewardRatio: number;
    riskPercent: number;
    rewardPercent: number;
  } {
    if (!this.isValid()) {
      return {
        entry: 0,
        stopLoss: 0,
        takeProfit: 0,
        risk: 0,
        reward: 0,
        riskRewardRatio: 0,
        riskPercent: 0,
        rewardPercent: 0,
      };
    }

    const entry = this._anchors[0].price;
    const stopLoss = this._anchors[1].price;
    const takeProfit = this._anchors[2].price;

    const risk = Math.abs(entry - stopLoss);
    const reward = Math.abs(takeProfit - entry);
    const riskRewardRatio = risk !== 0 ? reward / risk : 0;
    const riskPercent = entry !== 0 ? (risk / entry) * 100 : 0;
    const rewardPercent = entry !== 0 ? (reward / entry) * 100 : 0;

    return {
      entry,
      stopLoss,
      takeProfit,
      risk,
      reward,
      riskRewardRatio,
      riskPercent,
      rewardPercent,
    };
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p1 = this.anchorToPixel(this._anchors[0], viewport); // Entry
    const p2 = this.anchorToPixel(this._anchors[1], viewport); // Stop loss
    const p3 = this.anchorToPixel(this._anchors[2], viewport); // Take profit

    if (!p1 || !p2 || !p3) return [];

    const geometries: Geometry[] = [];
    const width = 200; // Fixed width for position box

    // Risk zone (entry to stop loss)
    const riskTop = Math.min(p1.y, p2.y);
    const riskHeight = Math.abs(p2.y - p1.y);
    geometries.push({
      type: 'rectangle',
      topLeft: { x: p1.x, y: riskTop },
      width,
      height: riskHeight,
    } as RectangleGeometry);

    // Reward zone (entry to take profit)
    const rewardTop = Math.min(p1.y, p3.y);
    const rewardHeight = Math.abs(p3.y - p1.y);
    geometries.push({
      type: 'rectangle',
      topLeft: { x: p1.x, y: rewardTop },
      width,
      height: rewardHeight,
    } as RectangleGeometry);

    return geometries;
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);
    const p3 = this.anchorToPixel(this._anchors[2], viewport);

    if (!p1 || !p2 || !p3) return false;

    const width = 200;
    const left = p1.x;
    const right = p1.x + width;
    const top = Math.min(p2.y, p3.y);
    const bottom = Math.max(p2.y, p3.y);

    return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
  }

  clone(newId: string): IDrawing {
    return new LongPosition(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._positionOptions }
    );
  }

  static create(
    id: string,
    entry: Anchor,
    stopLoss: Anchor,
    takeProfit: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<LongPositionOptions>
  ): LongPosition {
    return new LongPosition(id, [entry, stopLoss, takeProfit], style, options);
  }
}
