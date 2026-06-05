import type { IPrimitivePaneView } from 'lightweight-charts';

import { BaseLine } from './base-line';
import type { Anchor, DrawingStyle, DrawingOptions, IDrawing, Viewport } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { ArrowPaneView } from './arrow-pane-view';

/**
 * Arrow options
 */
export interface ArrowOptions extends DrawingOptions {
  arrowSize?: number;
  showBothEnds?: boolean;
}

/**
 * Arrow - A line with an arrowhead at the end.
 *
 * Features:
 * - Two anchor points
 * - Arrowhead at the end point
 * - Optional arrowhead at both ends
 * - Configurable arrow size
 */
export class Arrow extends BaseLine {
  readonly type = 'arrow';

  private _arrowOptions: ArrowOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<ArrowOptions> = {}
  ) {
    const { arrowSize, showBothEnds, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._arrowOptions = {
      ...this._options,
      arrowSize: arrowSize ?? 12,
      showBothEnds: showBothEnds ?? false,
    };
  }

  get arrowOptions(): ArrowOptions {
    return this._arrowOptions;
  }

  setArrowOptions(options: Partial<ArrowOptions>): void {
    this._arrowOptions = { ...this._arrowOptions, ...options };
    this.requestUpdate();
  }

  paneViews(): IPrimitivePaneView[] {
    return [new ArrowPaneView(this)];
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
    };

    return [lineGeometry];
  }

  clone(newId: string): IDrawing {
    return new Arrow(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._arrowOptions }
    );
  }

  static create(
    id: string,
    startAnchor: Anchor,
    endAnchor: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<ArrowOptions>
  ): Arrow {
    return new Arrow(id, [startAnchor, endAnchor], style, options);
  }
}
