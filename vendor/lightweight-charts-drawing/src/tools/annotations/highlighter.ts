import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, PolygonGeometry } from '../../core/geometry';
import { distanceToLineSegment } from '../../core/geometry';
import { HighlighterPaneView } from './highlighter-pane-view';

/**
 * Highlighter options
 */
export interface HighlighterOptions extends DrawingOptions {
  highlighterWidth?: number;
  opacity?: number;
}

/**
 * Highlighter - Semi-transparent highlight drawing tool.
 *
 * Features:
 * - Multiple anchor points forming a path
 * - Wide, semi-transparent stroke
 * - Ideal for marking important areas
 */
export class Highlighter extends Drawing {
  readonly type = 'highlighter';

  protected static readonly REQUIRED_ANCHORS = 2;
  protected static readonly HIT_THRESHOLD = 15;

  private _highlighterOptions: HighlighterOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<HighlighterOptions> = {}
  ) {
    const { highlighterWidth, opacity, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._highlighterOptions = {
      ...this._options,
      highlighterWidth: highlighterWidth ?? 20,
      opacity: opacity ?? 0.4,
    };
  }

  get highlighterOptions(): HighlighterOptions {
    return this._highlighterOptions;
  }

  setHighlighterOptions(options: Partial<HighlighterOptions>): void {
    this._highlighterOptions = { ...this._highlighterOptions, ...options };
    this.requestUpdate();
  }

  /**
   * Add a point to the highlighter path
   */
  addPoint(anchor: Anchor): void {
    this._anchors.push(anchor);
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= Highlighter.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new HighlighterPaneView(this)];
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
      if (dist <= Highlighter.HIT_THRESHOLD + (this._highlighterOptions.highlighterWidth ?? 20) / 2) {
        return true;
      }
    }

    return false;
  }

  clone(newId: string): IDrawing {
    return new Highlighter(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._highlighterOptions }
    );
  }

  static create(
    id: string,
    points: Anchor[],
    style?: Partial<DrawingStyle>,
    options?: Partial<HighlighterOptions>
  ): Highlighter {
    return new Highlighter(id, points, style, options);
  }
}
