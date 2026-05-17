import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { distanceToLineSegment } from '../../core/geometry';
import { DisjointChannelPaneView } from './disjoint-channel-pane-view';

/**
 * DisjointChannel options
 */
export interface DisjointChannelOptions extends DrawingOptions {
  filled?: boolean;
  extendLines?: boolean;
  showMiddleLine?: boolean;
}

/**
 * DisjointChannel - A channel with two independent lines that don't have to be parallel.
 *
 * Features:
 * - Four anchor points: two for upper line, two for lower line
 * - Lines can be at any angle (not necessarily parallel)
 * - Optional fill between lines
 * - Optional middle line
 * - Optional line extensions
 *
 * Points:
 * - Anchor 0-1: First line
 * - Anchor 2-3: Second line
 */
export class DisjointChannel extends Drawing {
  readonly type = 'disjoint-channel';

  protected static readonly REQUIRED_ANCHORS = 4;
  protected static readonly HIT_THRESHOLD = 5;

  private _channelOptions: DisjointChannelOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<DisjointChannelOptions> = {}
  ) {
    const { filled, extendLines, showMiddleLine, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._channelOptions = {
      ...this._options,
      filled: filled ?? true,
      extendLines: extendLines ?? false,
      showMiddleLine: showMiddleLine ?? false,
    };
  }

  get channelOptions(): DisjointChannelOptions {
    return this._channelOptions;
  }

  setChannelOptions(options: Partial<DisjointChannelOptions>): void {
    this._channelOptions = { ...this._channelOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= DisjointChannel.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new DisjointChannelPaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);
    const p3 = this.anchorToPixel(this._anchors[2], viewport);
    const p4 = this.anchorToPixel(this._anchors[3], viewport);

    if (!p1 || !p2 || !p3 || !p4) return [];

    const geometries: Geometry[] = [];

    // First line (p1 to p2)
    geometries.push({
      type: 'line',
      start: p1,
      end: p2,
      extendLeft: this._channelOptions.extendLines,
      extendRight: this._channelOptions.extendLines,
    } as LineGeometry);

    // Second line (p3 to p4)
    geometries.push({
      type: 'line',
      start: p3,
      end: p4,
      extendLeft: this._channelOptions.extendLines,
      extendRight: this._channelOptions.extendLines,
    } as LineGeometry);

    // Middle line (average of both lines)
    if (this._channelOptions.showMiddleLine) {
      const midStart = {
        x: (p1.x + p3.x) / 2,
        y: (p1.y + p3.y) / 2,
      };
      const midEnd = {
        x: (p2.x + p4.x) / 2,
        y: (p2.y + p4.y) / 2,
      };

      geometries.push({
        type: 'line',
        start: midStart,
        end: midEnd,
        extendLeft: this._channelOptions.extendLines,
        extendRight: this._channelOptions.extendLines,
      } as LineGeometry);
    }

    return geometries;
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const p1 = this.anchorToPixel(this._anchors[0], viewport);
    const p2 = this.anchorToPixel(this._anchors[1], viewport);
    const p3 = this.anchorToPixel(this._anchors[2], viewport);
    const p4 = this.anchorToPixel(this._anchors[3], viewport);

    if (!p1 || !p2 || !p3 || !p4) return false;

    // Check first line
    if (distanceToLineSegment(point, p1, p2) <= DisjointChannel.HIT_THRESHOLD) return true;

    // Check second line
    if (distanceToLineSegment(point, p3, p4) <= DisjointChannel.HIT_THRESHOLD) return true;

    // If filled, check if inside channel polygon
    if (this._channelOptions.filled) {
      if (this.isPointInPolygon(point, [p1, p2, p4, p3])) {
        return true;
      }
    }

    return false;
  }

  private isPointInPolygon(point: Point, polygon: Point[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;

      const intersect = ((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  clone(newId: string): IDrawing {
    return new DisjointChannel(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._channelOptions }
    );
  }

  static create(
    id: string,
    line1Start: Anchor,
    line1End: Anchor,
    line2Start: Anchor,
    line2End: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<DisjointChannelOptions>
  ): DisjointChannel {
    return new DisjointChannel(id, [line1Start, line1End, line2Start, line2End], style, options);
  }
}
