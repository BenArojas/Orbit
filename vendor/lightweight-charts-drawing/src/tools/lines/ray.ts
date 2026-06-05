import type { IPrimitivePaneView } from 'lightweight-charts';

import { BaseLine } from './base-line';
import type { Anchor, DrawingStyle, DrawingOptions, IDrawing, Viewport } from '../../core/types';
import type { Geometry, LineGeometry } from '../../core/geometry';
import { RayPaneView } from './ray-pane-view';

/**
 * Ray options
 */
export interface RayOptions extends DrawingOptions {
  showAngle?: boolean;
}

/**
 * Ray - A line that extends infinitely in one direction from the first anchor.
 *
 * Features:
 * - Two anchor points define the direction
 * - Extends infinitely from first anchor through second anchor
 * - Optional angle display
 */
export class Ray extends BaseLine {
  readonly type = 'ray';

  private _rayOptions: RayOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<RayOptions> = {}
  ) {
    const { showAngle, ...baseOptions } = options;
    // Force extendRight to true for ray behavior
    super(id, anchors, style, { ...baseOptions, extendRight: true });

    this._rayOptions = {
      ...this._options,
      showAngle: showAngle ?? false,
    };
  }

  get rayOptions(): RayOptions {
    return this._rayOptions;
  }

  setRayOptions(options: Partial<RayOptions>): void {
    this._rayOptions = { ...this._rayOptions, ...options };
    this.requestUpdate();
  }

  paneViews(): IPrimitivePaneView[] {
    return [new RayPaneView(this)];
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
      extendLeft: false,
      extendRight: true, // Always extend right for ray
    };

    return [lineGeometry];
  }

  clone(newId: string): IDrawing {
    return new Ray(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._rayOptions }
    );
  }

  static create(
    id: string,
    startAnchor: Anchor,
    endAnchor: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<RayOptions>
  ): Ray {
    return new Ray(id, [startAnchor, endAnchor], style, options);
  }
}
