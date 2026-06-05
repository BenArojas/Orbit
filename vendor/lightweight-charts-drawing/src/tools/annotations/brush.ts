import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, PolygonGeometry } from '../../core/geometry';
import { distanceToLineSegment } from '../../core/geometry';
import { BrushPaneView } from './brush-pane-view';

/**
 * Brush options
 */
export interface BrushOptions extends DrawingOptions {
  brushSize?: number;
  smoothing?: number;
}

/**
 * Brush - Freehand drawing tool.
 *
 * Features:
 * - Multiple anchor points forming a path
 * - Variable brush size
 * - Smooth line rendering
 */
export class Brush extends Drawing {
  readonly type = 'brush';

  protected static readonly REQUIRED_ANCHORS = 2;
  protected static readonly HIT_THRESHOLD = 10;

  private _brushOptions: BrushOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<BrushOptions> = {}
  ) {
    const { brushSize, smoothing, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._brushOptions = {
      ...this._options,
      brushSize: brushSize ?? 3,
      smoothing: smoothing ?? 0.5,
    };
  }

  get brushOptions(): BrushOptions {
    return this._brushOptions;
  }

  setBrushOptions(options: Partial<BrushOptions>): void {
    this._brushOptions = { ...this._brushOptions, ...options };
    this.requestUpdate();
  }

  /**
   * Add a point to the brush path
   */
  addPoint(anchor: Anchor): void {
    this._anchors.push(anchor);
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= Brush.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new BrushPaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const points: Point[] = [];
    for (const anchor of this._anchors) {
      const p = this.anchorToPixel(anchor, viewport);
      if (p) points.push(p);
    }

    if (points.length < 2) return [];

    const polygonGeometry: PolygonGeometry = {
      type: 'polygon',
      points,
      closed: false,
    };

    return [polygonGeometry];
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const points: Point[] = [];
    for (const anchor of this._anchors) {
      const p = this.anchorToPixel(anchor, viewport);
      if (p) points.push(p);
    }

    // Check if near any segment
    for (let i = 0; i < points.length - 1; i++) {
      const dist = distanceToLineSegment(point, points[i], points[i + 1]);
      if (dist <= Brush.HIT_THRESHOLD + (this._brushOptions.brushSize ?? 3)) {
        return true;
      }
    }

    return false;
  }

  clone(newId: string): IDrawing {
    return new Brush(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._brushOptions }
    );
  }

  static create(
    id: string,
    points: Anchor[],
    style?: Partial<DrawingStyle>,
    options?: Partial<BrushOptions>
  ): Brush {
    return new Brush(id, points, style, options);
  }
}
