import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry } from '../../core/geometry';
import { ArrowMarkerPaneView } from './arrow-marker-pane-view';

/**
 * Arrow direction
 */
export type ArrowDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Arrow marker options
 */
export interface ArrowMarkerOptions extends DrawingOptions {
  direction?: ArrowDirection;
  size?: number;
  filled?: boolean;
}

/**
 * Arrow Marker - A directional arrow placed at a single point.
 *
 * Features:
 * - Single anchor point
 * - Configurable direction (up, down, left, right)
 * - Configurable size
 * - Optional fill
 */
export class ArrowMarker extends Drawing {
  readonly type = 'arrow-marker';

  protected static readonly REQUIRED_ANCHORS = 1;
  protected static readonly HIT_THRESHOLD = 10;

  private _arrowOptions: ArrowMarkerOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<ArrowMarkerOptions> = {}
  ) {
    const { direction, size, filled, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._arrowOptions = {
      ...this._options,
      direction: direction ?? 'up',
      size: size ?? 20,
      filled: filled ?? true,
    };
  }

  get arrowOptions(): ArrowMarkerOptions {
    return this._arrowOptions;
  }

  setArrowOptions(options: Partial<ArrowMarkerOptions>): void {
    this._arrowOptions = { ...this._arrowOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= ArrowMarker.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new ArrowMarkerPaneView(this)];
  }

  /**
   * Get arrow vertices based on position and direction
   */
  getArrowVertices(viewport: Viewport): Point[] | null {
    if (!this.isValid()) return null;

    const anchor = this.anchorToPixel(this._anchors[0], viewport);
    if (!anchor) return null;

    const size = this._arrowOptions.size ?? 20;
    const direction = this._arrowOptions.direction ?? 'up';

    // Arrow is an isoceles triangle
    const halfBase = size * 0.5;
    const height = size;

    switch (direction) {
      case 'up':
        return [
          { x: anchor.x, y: anchor.y - height / 2 },              // tip
          { x: anchor.x - halfBase, y: anchor.y + height / 2 },   // bottom left
          { x: anchor.x + halfBase, y: anchor.y + height / 2 },   // bottom right
        ];
      case 'down':
        return [
          { x: anchor.x, y: anchor.y + height / 2 },              // tip
          { x: anchor.x - halfBase, y: anchor.y - height / 2 },   // top left
          { x: anchor.x + halfBase, y: anchor.y - height / 2 },   // top right
        ];
      case 'left':
        return [
          { x: anchor.x - height / 2, y: anchor.y },              // tip
          { x: anchor.x + height / 2, y: anchor.y - halfBase },   // top right
          { x: anchor.x + height / 2, y: anchor.y + halfBase },   // bottom right
        ];
      case 'right':
        return [
          { x: anchor.x + height / 2, y: anchor.y },              // tip
          { x: anchor.x - height / 2, y: anchor.y - halfBase },   // top left
          { x: anchor.x - height / 2, y: anchor.y + halfBase },   // bottom left
        ];
      default:
        return null;
    }
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    const vertices = this.getArrowVertices(viewport);
    if (!vertices) return [];

    return [{
      type: 'polygon',
      points: vertices,
      closed: true,
    }];
  }

  testHit(point: Point, viewport: Viewport): boolean {
    const vertices = this.getArrowVertices(viewport);
    if (!vertices || vertices.length < 3) return false;

    // Point in triangle test using barycentric coordinates
    return this.pointInTriangle(point, vertices[0], vertices[1], vertices[2]);
  }

  private pointInTriangle(p: Point, v1: Point, v2: Point, v3: Point): boolean {
    const sign = (p1: Point, p2: Point, p3: Point): number => {
      return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
    };

    const d1 = sign(p, v1, v2);
    const d2 = sign(p, v2, v3);
    const d3 = sign(p, v3, v1);

    const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);

    return !(hasNeg && hasPos);
  }

  clone(newId: string): IDrawing {
    return new ArrowMarker(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._arrowOptions }
    );
  }

  static create(
    id: string,
    position: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<ArrowMarkerOptions>
  ): ArrowMarker {
    return new ArrowMarker(id, [position], style, options);
  }
}
