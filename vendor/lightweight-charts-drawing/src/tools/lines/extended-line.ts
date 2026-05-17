import type { IPrimitivePaneView } from 'lightweight-charts';

import { BaseLine } from './base-line';
import type { Anchor, DrawingStyle, DrawingOptions, IDrawing, Viewport } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { ExtendedLinePaneView } from './extended-line-pane-view';

/**
 * ExtendedLine options
 */
export interface ExtendedLineOptions extends DrawingOptions {
  showAngle?: boolean;
}

/**
 * ExtendedLine - A line that extends infinitely in both directions.
 *
 * Features:
 * - Two anchor points define the line
 * - Extends infinitely in both directions
 * - Optional angle display
 */
export class ExtendedLine extends BaseLine {
  readonly type = 'extended-line';

  private _extendedLineOptions: ExtendedLineOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<ExtendedLineOptions> = {}
  ) {
    const { showAngle, ...baseOptions } = options;
    // Force both extensions to true
    super(id, anchors, style, { ...baseOptions, extendLeft: true, extendRight: true });

    this._extendedLineOptions = {
      ...this._options,
      showAngle: showAngle ?? false,
    };
  }

  get extendedLineOptions(): ExtendedLineOptions {
    return this._extendedLineOptions;
  }

  setExtendedLineOptions(options: Partial<ExtendedLineOptions>): void {
    this._extendedLineOptions = { ...this._extendedLineOptions, ...options };
    this.requestUpdate();
  }

  paneViews(): IPrimitivePaneView[] {
    return [new ExtendedLinePaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const start = this.anchorToPixel(this._anchors[0], viewport);
    const end = this.anchorToPixel(this._anchors[1], viewport);

    if (!start || !end) return [];

    const lineGeometry: LineGeometry = {
      type: 'line',
      start,
      end,
      extendLeft: true,
      extendRight: true,
    };

    return [lineGeometry];
  }

  clone(newId: string): IDrawing {
    return new ExtendedLine(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._extendedLineOptions }
    );
  }

  static create(
    id: string,
    startAnchor: Anchor,
    endAnchor: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<ExtendedLineOptions>
  ): ExtendedLine {
    return new ExtendedLine(id, [startAnchor, endAnchor], style, options);
  }
}
