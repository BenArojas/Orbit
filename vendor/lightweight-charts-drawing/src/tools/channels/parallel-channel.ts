import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { distanceToLineSegment } from '../../core/geometry';
import { ParallelChannelPaneView } from './parallel-channel-pane-view';

/**
 * ParallelChannel options
 */
export interface ParallelChannelOptions extends DrawingOptions {
  filled?: boolean;
  showMiddleLine?: boolean;
  extendLines?: boolean;
}

/**
 * ParallelChannel - Two parallel lines forming a channel.
 *
 * Features:
 * - Three anchor points (two for baseline, one for channel width)
 * - Optional fill between lines
 * - Optional middle line
 * - Optional line extensions
 */
export class ParallelChannel extends Drawing {
  readonly type = 'parallel-channel';

  protected static readonly REQUIRED_ANCHORS = 3;
  protected static readonly HIT_THRESHOLD = 5;

  private _channelOptions: ParallelChannelOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<ParallelChannelOptions> = {}
  ) {
    const { filled, showMiddleLine, extendLines, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._channelOptions = {
      ...this._options,
      filled: filled ?? true,
      showMiddleLine: showMiddleLine ?? true,
      extendLines: extendLines ?? false,
    };
  }

  get channelOptions(): ParallelChannelOptions {
    return this._channelOptions;
  }

  setChannelOptions(options: Partial<ParallelChannelOptions>): void {
    this._channelOptions = { ...this._channelOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= ParallelChannel.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new ParallelChannelPaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);
    const p3 = this.anchorToPixel(this._anchors[2], viewport);

    if (!p1 || !p2 || !p3) return [];

    const geometries: Geometry[] = [];

    // Baseline (p1 to p2)
    geometries.push({
      type: 'line',
      start: p1,
      end: p2,
      extendLeft: this._channelOptions.extendLines,
      extendRight: this._channelOptions.extendLines,
    } as LineGeometry);

    // Project p3 onto baseline and calculate perpendicular offset
    const offset = this.calculateOffset(p1, p2, p3);

    // Parallel line
    const p1Parallel = { x: p1.x + offset.x, y: p1.y + offset.y };
    const p2Parallel = { x: p2.x + offset.x, y: p2.y + offset.y };

    geometries.push({
      type: 'line',
      start: p1Parallel,
      end: p2Parallel,
      extendLeft: this._channelOptions.extendLines,
      extendRight: this._channelOptions.extendLines,
    } as LineGeometry);

    // Middle line
    if (this._channelOptions.showMiddleLine) {
      const p1Middle = { x: (p1.x + p1Parallel.x) / 2, y: (p1.y + p1Parallel.y) / 2 };
      const p2Middle = { x: (p2.x + p2Parallel.x) / 2, y: (p2.y + p2Parallel.y) / 2 };

      geometries.push({
        type: 'line',
        start: p1Middle,
        end: p2Middle,
        extendLeft: this._channelOptions.extendLines,
        extendRight: this._channelOptions.extendLines,
      } as LineGeometry);
    }

    return geometries;
  }

  private calculateOffset(p1: Point, p2: Point, p3: Point): Point {
    // Vector from p1 to p2
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len === 0) return { x: 0, y: p3.y - p1.y };

    // Unit normal vector (perpendicular to baseline)
    const nx = -dy / len;
    const ny = dx / len;

    // Vector from p1 to p3
    const vx = p3.x - p1.x;
    const vy = p3.y - p1.y;

    // Project onto normal to get distance
    const dist = vx * nx + vy * ny;

    return { x: nx * dist, y: ny * dist };
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);
    const p3 = this.anchorToPixel(this._anchors[2], viewport);

    if (!p1 || !p2 || !p3) return false;

    // Check baseline
    if (distanceToLineSegment(point, p1, p2) <= ParallelChannel.HIT_THRESHOLD) return true;

    // Check parallel line
    const offset = this.calculateOffset(p1, p2, p3);
    const p1Parallel = { x: p1.x + offset.x, y: p1.y + offset.y };
    const p2Parallel = { x: p2.x + offset.x, y: p2.y + offset.y };

    if (distanceToLineSegment(point, p1Parallel, p2Parallel) <= ParallelChannel.HIT_THRESHOLD) return true;

    // If filled, check if inside channel
    if (this._channelOptions.filled) {
      // Simple bounding check
      const minX = Math.min(p1.x, p2.x, p1Parallel.x, p2Parallel.x);
      const maxX = Math.max(p1.x, p2.x, p1Parallel.x, p2Parallel.x);
      const minY = Math.min(p1.y, p2.y, p1Parallel.y, p2Parallel.y);
      const maxY = Math.max(p1.y, p2.y, p1Parallel.y, p2Parallel.y);

      if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) {
        return true;
      }
    }

    return false;
  }

  clone(newId: string): IDrawing {
    return new ParallelChannel(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._channelOptions }
    );
  }

  static create(
    id: string,
    start: Anchor,
    end: Anchor,
    width: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<ParallelChannelOptions>
  ): ParallelChannel {
    return new ParallelChannel(id, [start, end, width], style, options);
  }
}
