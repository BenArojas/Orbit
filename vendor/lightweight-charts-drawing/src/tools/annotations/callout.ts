import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry } from '../../core/geometry';
import { CalloutPaneView } from './callout-pane-view';

/**
 * Callout options
 */
export interface CalloutOptions extends DrawingOptions {
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  backgroundColor?: string;
  borderColor?: string;
  padding?: number;
  pointerSize?: number;
}

/**
 * Callout - A text box with a pointer to a specific point.
 *
 * Features:
 * - Two anchor points (target and box position)
 * - Text box with pointer/arrow to target
 * - Customizable appearance
 */
export class Callout extends Drawing {
  readonly type = 'callout';

  protected static readonly REQUIRED_ANCHORS = 2;
  protected static readonly HIT_THRESHOLD = 10;

  private _calloutOptions: CalloutOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<CalloutOptions> = {}
  ) {
    const { text, fontSize, fontFamily, backgroundColor, borderColor, padding, pointerSize, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._calloutOptions = {
      ...this._options,
      text: text ?? 'Callout',
      fontSize: fontSize ?? 12,
      fontFamily: fontFamily ?? 'sans-serif',
      backgroundColor: backgroundColor ?? 'rgba(255, 255, 200, 0.95)',
      borderColor: borderColor ?? '#FFC107',
      padding: padding ?? 8,
      pointerSize: pointerSize ?? 10,
    };
  }

  get calloutOptions(): CalloutOptions {
    return this._calloutOptions;
  }

  setCalloutOptions(options: Partial<CalloutOptions>): void {
    this._calloutOptions = { ...this._calloutOptions, ...options };
    this.requestUpdate();
  }

  setText(text: string): void {
    this._calloutOptions.text = text;
    this.requestUpdate();
  }

  getText(): string {
    return this._calloutOptions.text ?? '';
  }

  isValid(): boolean {
    return this._anchors.length >= Callout.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new CalloutPaneView(this)];
  }

  computeGeometry(_viewport: Viewport): Geometry[] {
    // Callout uses custom rendering, no standard geometry
    return [];
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    const target = this.anchorToPixel(this._anchors[0], viewport);
    const boxPos = this.anchorToPixel(this._anchors[1], viewport);

    if (!target || !boxPos) return false;

    // Check if near target point
    const distToTarget = Math.sqrt(
      Math.pow(point.x - target.x, 2) + Math.pow(point.y - target.y, 2)
    );
    if (distToTarget <= Callout.HIT_THRESHOLD) return true;

    // Check if inside text box (approximate)
    const options = this._calloutOptions;
    const estimatedWidth = (options.text?.length ?? 0) * (options.fontSize ?? 12) * 0.6 + (options.padding ?? 8) * 2;
    const estimatedHeight = (options.fontSize ?? 12) * 1.5 + (options.padding ?? 8) * 2;

    return (
      point.x >= boxPos.x &&
      point.x <= boxPos.x + estimatedWidth &&
      point.y >= boxPos.y - estimatedHeight / 2 &&
      point.y <= boxPos.y + estimatedHeight / 2
    );
  }

  clone(newId: string): IDrawing {
    return new Callout(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._calloutOptions }
    );
  }

  static create(
    id: string,
    target: Anchor,
    boxPosition: Anchor,
    text: string,
    style?: Partial<DrawingStyle>,
    options?: Partial<CalloutOptions>
  ): Callout {
    return new Callout(id, [target, boxPosition], style, { ...options, text });
  }
}
