import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry } from '../../core/geometry';
import { PinPaneView } from './pin-pane-view';

/**
 * Pin options
 */
export interface PinOptions extends DrawingOptions {
  color?: string;
  size?: number;
  label?: string;
}

/**
 * Pin - A simple pin/map marker annotation.
 *
 * Features:
 * - Single anchor point
 * - Teardrop/pin shape
 * - Optional short label
 */
export class Pin extends Drawing {
  readonly type = 'pin';

  protected static readonly REQUIRED_ANCHORS = 1;
  protected static readonly HIT_THRESHOLD = 15;

  private _pinOptions: PinOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<PinOptions> = {}
  ) {
    const { color, size, label, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._pinOptions = {
      ...this._options,
      color: color ?? '#E91E63',
      size: size ?? 24,
      label: label ?? '',
    };
  }

  get pinOptions(): PinOptions {
    return this._pinOptions;
  }

  setPinOptions(options: Partial<PinOptions>): void {
    this._pinOptions = { ...this._pinOptions, ...options };
    this.requestUpdate();
  }

  setLabel(label: string): void {
    this._pinOptions.label = label;
    this.requestUpdate();
  }

  getLabel(): string {
    return this._pinOptions.label ?? '';
  }

  isValid(): boolean {
    return this._anchors.length >= Pin.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new PinPaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p = this.anchorToPixel(this._anchors[0], viewport);
    if (!p) return [];

    return [{
      type: 'polygon',
      points: [p],
      closed: false,
    }];
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const p = this.anchorToPixel(this._anchors[0], viewport);
    if (!p) return false;

    const size = this._pinOptions.size ?? 24;
    return (
      point.x >= p.x - size / 2 &&
      point.x <= p.x + size / 2 &&
      point.y >= p.y - size * 1.5 &&
      point.y <= p.y
    );
  }

  clone(newId: string): IDrawing {
    return new Pin(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._pinOptions }
    );
  }

  static create(
    id: string,
    position: Anchor,
    style?: Partial<DrawingStyle>,
    options?: Partial<PinOptions>
  ): Pin {
    return new Pin(id, [position], style, options);
  }
}
