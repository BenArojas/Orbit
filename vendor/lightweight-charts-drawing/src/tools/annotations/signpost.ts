import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry } from '../../core/geometry';
import { SignpostPaneView } from './signpost-pane-view';

/**
 * Signpost options
 */
export interface SignpostOptions extends DrawingOptions {
  text?: string;
  fontSize?: number;
  backgroundColor?: string;
  textColor?: string;
  direction?: 'left' | 'right';
}

/**
 * Signpost - A directional signpost marker.
 *
 * Features:
 * - Single anchor point
 * - Directional arrow-shaped sign (left/right)
 * - Text label on the sign
 */
export class Signpost extends Drawing {
  readonly type = 'signpost';

  protected static readonly REQUIRED_ANCHORS = 1;
  protected static readonly HIT_THRESHOLD = 15;

  private _signpostOptions: SignpostOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<SignpostOptions> = {}
  ) {
    const { text, fontSize, backgroundColor, textColor, direction, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._signpostOptions = {
      ...this._options,
      text: text ?? 'Signpost',
      fontSize: fontSize ?? 11,
      backgroundColor: backgroundColor ?? '#FF9800',
      textColor: textColor ?? '#000000',
      direction: direction ?? 'right',
    };
  }

  get signpostOptions(): SignpostOptions {
    return this._signpostOptions;
  }

  setSignpostOptions(options: Partial<SignpostOptions>): void {
    this._signpostOptions = { ...this._signpostOptions, ...options };
    this.requestUpdate();
  }

  setText(text: string): void {
    this._signpostOptions.text = text;
    this.requestUpdate();
  }

  getText(): string {
    return this._signpostOptions.text ?? '';
  }

  isValid(): boolean {
    return this._anchors.length >= Signpost.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new SignpostPaneView(this)];
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

    const size = 100;
    const height = 28;
    const isRight = this._signpostOptions.direction !== 'left';

    if (isRight) {
      return (
        point.x >= p.x &&
        point.x <= p.x + size &&
        point.y >= p.y - height &&
        point.y <= p.y
      );
    } else {
      return (
        point.x >= p.x - size &&
        point.x <= p.x &&
        point.y >= p.y - height &&
        point.y <= p.y
      );
    }
  }

  clone(newId: string): IDrawing {
    return new Signpost(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._signpostOptions }
    );
  }

  static create(
    id: string,
    position: Anchor,
    text: string,
    style?: Partial<DrawingStyle>,
    options?: Partial<SignpostOptions>
  ): Signpost {
    return new Signpost(id, [position], style, { ...options, text });
  }
}
