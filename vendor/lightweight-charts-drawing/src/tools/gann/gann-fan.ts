import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { distanceToLineSegment } from '../../core/geometry';
import { GannFanPaneView } from './gann-fan-pane-view';

/**
 * Standard Gann fan angles (rise/run ratios)
 */
export const GANN_FAN_ANGLES = [
  { ratio: 8, label: '8x1' },
  { ratio: 4, label: '4x1' },
  { ratio: 3, label: '3x1' },
  { ratio: 2, label: '2x1' },
  { ratio: 1, label: '1x1' },
  { ratio: 0.5, label: '1x2' },
  { ratio: 0.333, label: '1x3' },
  { ratio: 0.25, label: '1x4' },
  { ratio: 0.125, label: '1x8' },
];

/**
 * GannFan options
 */
export interface GannFanOptions extends DrawingOptions {
  angles?: { ratio: number; label: string }[];
  showLabels?: boolean;
  extendLines?: boolean;
}

/**
 * GannFan - Gann fan lines radiating from a point.
 *
 * Features:
 * - Two anchor points (origin and direction)
 * - Multiple fan lines at Gann angles
 * - Optional labels for each angle
 */
export class GannFan extends Drawing {
  readonly type = 'gann-fan';

  protected static readonly REQUIRED_ANCHORS = 2;
  protected static readonly HIT_THRESHOLD = 5;

  private _gannOptions: GannFanOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<GannFanOptions> = {}
  ) {
    const { angles, showLabels, extendLines, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._gannOptions = {
      ...this._options,
      angles: angles ?? GANN_FAN_ANGLES,
      showLabels: showLabels ?? true,
      extendLines: extendLines ?? true,
    };
  }

  get gannOptions(): GannFanOptions {
    return this._gannOptions;
  }

  setGannOptions(options: Partial<GannFanOptions>): void {
    this._gannOptions = { ...this._gannOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= GannFan.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new GannFanPaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);

    if (!p1 || !p2) return [];

    const geometries: Geometry[] = [];
    const angles = this._gannOptions.angles ?? GANN_FAN_ANGLES;

    // Calculate base direction and scale
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const baseLen = Math.sqrt(dx * dx + dy * dy);

    if (baseLen === 0) return [];

    // Normalize direction (1x1 line)
    const unitX = dx / baseLen;
    const unitY = dy / baseLen;

    // For each angle, compute line
    for (const angle of angles) {
      // Adjust Y based on ratio
      const fanDx = unitX * baseLen * 2;
      const fanDy = unitY * baseLen * 2 * angle.ratio;

      const end: Point = {
        x: p1.x + fanDx,
        y: p1.y + fanDy,
      };

      geometries.push({
        type: 'line',
        start: p1,
        end,
        extendRight: this._gannOptions.extendLines,
      } as LineGeometry);
    }

    return geometries;
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);

    if (!p1 || !p2) return false;

    const angles = this._gannOptions.angles ?? GANN_FAN_ANGLES;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const baseLen = Math.sqrt(dx * dx + dy * dy);

    if (baseLen === 0) return false;

    const unitX = dx / baseLen;
    const unitY = dy / baseLen;

    for (const angle of angles) {
      const fanDx = unitX * baseLen * 2;
      const fanDy = unitY * baseLen * 2 * angle.ratio;

      const end: Point = {
        x: p1.x + fanDx,
        y: p1.y + fanDy,
      };

      if (distanceToLineSegment(point, p1, end) <= GannFan.HIT_THRESHOLD) {
        return true;
      }
    }

    return false;
  }

  clone(newId: string): IDrawing {
    return new GannFan(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._gannOptions }
    );
  }

  static create(
    id: string,
    origin: Anchor,
    direction: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<GannFanOptions>
  ): GannFan {
    return new GannFan(id, [origin, direction], style, options);
  }
}
