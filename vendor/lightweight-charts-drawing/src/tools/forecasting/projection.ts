import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry, RectangleGeometry } from '../../core/geometry';
import { distanceToLineSegment } from '../../core/geometry';
import { ProjectionPaneView } from './projection-pane-view';

/**
 * Projection options
 */
export interface ProjectionOptions extends DrawingOptions {
  showPrices?: boolean;
  showPercentage?: boolean;
  showLabels?: boolean;
  filled?: boolean;
}

/**
 * Projection - Price projection tool.
 *
 * Features:
 * - Three anchor points: initial move (A to B), projection start (C)
 * - Projects the A-B move from point C
 * - Shows target price and percentage
 */
export class Projection extends Drawing {
  readonly type = 'projection';

  protected static readonly REQUIRED_ANCHORS = 3;
  protected static readonly HIT_THRESHOLD = 5;

  private _projectionOptions: ProjectionOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<ProjectionOptions> = {}
  ) {
    const { showPrices, showPercentage, showLabels, filled, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._projectionOptions = {
      ...this._options,
      showPrices: showPrices ?? true,
      showPercentage: showPercentage ?? true,
      showLabels: showLabels ?? true,
      filled: filled ?? true,
    };
  }

  get projectionOptions(): ProjectionOptions {
    return this._projectionOptions;
  }

  setProjectionOptions(options: Partial<ProjectionOptions>): void {
    this._projectionOptions = { ...this._projectionOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= Projection.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new ProjectionPaneView(this)];
  }

  /**
   * Get projection info
   * Anchors: [0] = A (start of reference move)
   *          [1] = B (end of reference move)
   *          [2] = C (projection start point)
   */
  getProjectionInfo(): {
    priceA: number;
    priceB: number;
    priceC: number;
    targetPrice: number;
    moveSize: number;
    movePercent: number;
    isUp: boolean;
  } {
    if (!this.isValid()) {
      return {
        priceA: 0,
        priceB: 0,
        priceC: 0,
        targetPrice: 0,
        moveSize: 0,
        movePercent: 0,
        isUp: true,
      };
    }

    const priceA = this._anchors[0].price;
    const priceB = this._anchors[1].price;
    const priceC = this._anchors[2].price;

    // Calculate the move from A to B
    const moveSize = priceB - priceA;
    const movePercent = priceA !== 0 ? (moveSize / priceA) * 100 : 0;

    // Project the same move from C
    const targetPrice = priceC + moveSize;
    const isUp = moveSize >= 0;

    return {
      priceA,
      priceB,
      priceC,
      targetPrice,
      moveSize,
      movePercent,
      isUp,
    };
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const pA = this.anchorToPixel(this._anchors[0], viewport);
    const pB = this.anchorToPixel(this._anchors[1], viewport);
    const pC = this.anchorToPixel(this._anchors[2], viewport);

    if (!pA || !pB || !pC) return [];

    const geometries: Geometry[] = [];

    // Reference line A-B
    geometries.push({
      type: 'line',
      start: pA,
      end: pB,
    } as LineGeometry);

    // Calculate target point D (projection of A-B from C)
    const dy = pB.y - pA.y;
    const dx = pB.x - pA.x;
    const pD: Point = {
      x: pC.x + dx,
      y: pC.y + dy,
    };

    // Projection line C-D
    geometries.push({
      type: 'line',
      start: pC,
      end: pD,
    } as LineGeometry);

    // Connecting lines (optional visual aid)
    geometries.push({
      type: 'line',
      start: pA,
      end: pC,
    } as LineGeometry);

    geometries.push({
      type: 'line',
      start: pB,
      end: pD,
    } as LineGeometry);

    // Projection zone rectangle
    const left = Math.min(pC.x, pD.x);
    const right = Math.max(pC.x, pD.x);
    const top = Math.min(pC.y, pD.y);
    const bottom = Math.max(pC.y, pD.y);

    geometries.push({
      type: 'rectangle',
      topLeft: { x: left, y: top },
      width: right - left,
      height: bottom - top,
    } as RectangleGeometry);

    return geometries;
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const pA = this.anchorToPixel(this._anchors[0], viewport);
    const pB = this.anchorToPixel(this._anchors[1], viewport);
    const pC = this.anchorToPixel(this._anchors[2], viewport);

    if (!pA || !pB || !pC) return false;

    const dy = pB.y - pA.y;
    const dx = pB.x - pA.x;
    const pD: Point = {
      x: pC.x + dx,
      y: pC.y + dy,
    };

    // Check if near any of the lines
    if (distanceToLineSegment(point, pA, pB) <= Projection.HIT_THRESHOLD) return true;
    if (distanceToLineSegment(point, pC, pD) <= Projection.HIT_THRESHOLD) return true;
    if (distanceToLineSegment(point, pA, pC) <= Projection.HIT_THRESHOLD) return true;
    if (distanceToLineSegment(point, pB, pD) <= Projection.HIT_THRESHOLD) return true;

    return false;
  }

  clone(newId: string): IDrawing {
    return new Projection(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._projectionOptions }
    );
  }

  static create(
    id: string,
    pointA: Anchor,
    pointB: Anchor,
    pointC: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<ProjectionOptions>
  ): Projection {
    return new Projection(id, [pointA, pointB, pointC], style, options);
  }
}
