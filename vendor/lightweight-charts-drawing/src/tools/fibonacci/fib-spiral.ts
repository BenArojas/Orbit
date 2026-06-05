import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry } from '../../core/geometry';
import { distanceBetweenPoints } from '../../core/geometry';
import { FibSpiralPaneView } from './fib-spiral-pane-view';

/**
 * Golden ratio for spiral
 */
export const GOLDEN_RATIO = 1.618033988749895;

/**
 * FibSpiral options
 */
export interface FibSpiralOptions extends DrawingOptions {
  rotations?: number;
  clockwise?: boolean;
  showSquares?: boolean;
}

/**
 * FibSpiral - Golden spiral based on Fibonacci sequence.
 *
 * Features:
 * - Two anchor points (center and size reference)
 * - Logarithmic spiral with golden ratio growth
 * - Optional Fibonacci squares overlay
 * - Configurable rotation direction
 */
export class FibSpiral extends Drawing {
  readonly type = 'fib-spiral';

  protected static readonly REQUIRED_ANCHORS = 2;
  protected static readonly HIT_THRESHOLD = 8;

  private _fibOptions: FibSpiralOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<FibSpiralOptions> = {}
  ) {
    const { rotations, clockwise, showSquares, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._fibOptions = {
      ...this._options,
      rotations: rotations ?? 4,
      clockwise: clockwise ?? true,
      showSquares: showSquares ?? false,
    };
  }

  get fibOptions(): FibSpiralOptions {
    return this._fibOptions;
  }

  setFibOptions(options: Partial<FibSpiralOptions>): void {
    this._fibOptions = { ...this._fibOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= FibSpiral.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new FibSpiralPaneView(this)];
  }

  /**
   * Generate points along the golden spiral
   */
  getSpiralPoints(center: Point, startRadius: number, rotations: number, clockwise: boolean): Point[] {
    const points: Point[] = [];
    const segments = rotations * 90; // Points per quarter rotation
    const b = Math.log(GOLDEN_RATIO) / (Math.PI / 2); // Growth factor

    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * rotations * Math.PI * 2;
      const r = startRadius * Math.exp(b * theta);

      const angle = clockwise ? -theta : theta;
      points.push({
        x: center.x + r * Math.cos(angle),
        y: center.y + r * Math.sin(angle),
      });
    }

    return points;
  }

  computeGeometry(_viewport: Viewport): Geometry[] {
    // Spiral uses custom rendering, not standard geometry
    return [];
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);

    if (!p1 || !p2) return false;

    const startRadius = distanceBetweenPoints(p1, p2) / GOLDEN_RATIO;
    const spiralPoints = this.getSpiralPoints(
      p1,
      startRadius,
      this._fibOptions.rotations ?? 4,
      this._fibOptions.clockwise ?? true
    );

    // Check if near any segment of the spiral
    for (let i = 0; i < spiralPoints.length - 1; i++) {
      const segStart = spiralPoints[i];
      const segEnd = spiralPoints[i + 1];

      // Simple distance check to line segment
      const dx = segEnd.x - segStart.x;
      const dy = segEnd.y - segStart.y;
      const len = Math.sqrt(dx * dx + dy * dy);

      if (len === 0) continue;

      const t = Math.max(0, Math.min(1,
        ((point.x - segStart.x) * dx + (point.y - segStart.y) * dy) / (len * len)
      ));

      const projX = segStart.x + t * dx;
      const projY = segStart.y + t * dy;
      const dist = Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2);

      if (dist <= FibSpiral.HIT_THRESHOLD) {
        return true;
      }
    }

    return false;
  }

  clone(newId: string): IDrawing {
    return new FibSpiral(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._fibOptions }
    );
  }

  static create(
    id: string,
    center: Anchor,
    sizeRef: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<FibSpiralOptions>
  ): FibSpiral {
    return new FibSpiral(id, [center, sizeRef], style, options);
  }
}
