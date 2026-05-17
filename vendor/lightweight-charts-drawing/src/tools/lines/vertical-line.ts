import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { VerticalLinePaneView } from './vertical-line-pane-view';

/**
 * VerticalLine options
 */
export interface VerticalLineOptions extends DrawingOptions {
  showTime?: boolean;
  showLabel?: boolean;
  labelText?: string;
}

/**
 * VerticalLine - A vertical line at a specific time.
 *
 * Features:
 * - Single anchor point (time)
 * - Extends across entire viewport height
 * - Optional time label
 * - Optional custom label text
 */
export class VerticalLine extends Drawing {
  readonly type = 'vertical-line';

  protected static readonly REQUIRED_ANCHORS = 1;
  protected static readonly HIT_THRESHOLD = 5;

  private _verticalLineOptions: VerticalLineOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<VerticalLineOptions> = {}
  ) {
    const { showTime, showLabel, labelText, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._verticalLineOptions = {
      ...this._options,
      showTime: showTime ?? true,
      showLabel: showLabel ?? false,
      labelText: labelText ?? '',
    };
  }

  get verticalLineOptions(): VerticalLineOptions {
    return this._verticalLineOptions;
  }

  setVerticalLineOptions(options: Partial<VerticalLineOptions>): void {
    this._verticalLineOptions = { ...this._verticalLineOptions, ...options };
    this.requestUpdate();
  }

  isValid(): boolean {
    return this._anchors.length >= VerticalLine.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new VerticalLinePaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const anchor = this._anchors[0];
    const x = viewport.timeScale.timeToCoordinate(anchor.time);
    if (x === null) return [];

    const geometries: Geometry[] = [];

    // Vertical line spanning viewport
    const lineGeometry: LineGeometry = {
      type: 'line',
      start: { x, y: 0 },
      end: { x, y: viewport.height },
    };
    geometries.push(lineGeometry);

    return geometries;
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const anchor = this._anchors[0];
    const x = viewport.timeScale.timeToCoordinate(anchor.time);
    if (x === null) return false;

    return Math.abs(point.x - x) <= VerticalLine.HIT_THRESHOLD;
  }

  clone(newId: string): IDrawing {
    return new VerticalLine(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._verticalLineOptions }
    );
  }

  static create(
    id: string,
    time: number | string,
    price: number,
    style?: Partial<DrawingStyle>,
    options?: Partial<VerticalLineOptions>
  ): VerticalLine {
    return new VerticalLine(id, [{ time: time as any, price }], style, options);
  }
}
