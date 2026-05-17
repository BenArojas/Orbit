import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, TextGeometry } from '../../core/geometry';
import { AnchoredTextPaneView } from './anchored-text-pane-view';

/**
 * Anchored Text options
 */
export interface AnchoredTextOptions extends DrawingOptions {
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  textAlign?: CanvasTextAlign;
  showConnector?: boolean;
  connectorLength?: number;
}

/**
 * Anchored Text - Text anchored to a specific point with a connector line.
 *
 * Features:
 * - Two anchor points: anchor position and text position
 * - Connector line between anchor and text
 * - Customizable text styling
 */
export class AnchoredText extends Drawing {
  readonly type = 'anchored-text';

  protected static readonly REQUIRED_ANCHORS = 2;
  protected static readonly HIT_THRESHOLD = 10;

  private _textOptions: AnchoredTextOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<AnchoredTextOptions> = {}
  ) {
    const { text, fontSize, fontFamily, fontWeight, textAlign, showConnector, connectorLength, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._textOptions = {
      ...this._options,
      text: text ?? 'Anchored Text',
      fontSize: fontSize ?? 12,
      fontFamily: fontFamily ?? 'sans-serif',
      fontWeight: fontWeight ?? 'normal',
      textAlign: textAlign ?? 'left',
      showConnector: showConnector ?? true,
      connectorLength: connectorLength ?? 30,
    };
  }

  get textOptions(): AnchoredTextOptions {
    return this._textOptions;
  }

  setTextOptions(options: Partial<AnchoredTextOptions>): void {
    this._textOptions = { ...this._textOptions, ...options };
    this.requestUpdate();
  }

  setText(text: string): void {
    this._textOptions.text = text;
    this.requestUpdate();
  }

  getText(): string {
    return this._textOptions.text ?? '';
  }

  isValid(): boolean {
    return this._anchors.length >= AnchoredText.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new AnchoredTextPaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const textPos = this.anchorToPixel(this._anchors[1], viewport);
    if (!textPos) return [];

    const textGeometry: TextGeometry = {
      type: 'text',
      position: textPos,
      text: this._textOptions.text ?? '',
      font: `${this._textOptions.fontWeight} ${this._textOptions.fontSize}px ${this._textOptions.fontFamily}`,
      color: this._style.labelColor,
      align: this._textOptions.textAlign,
      baseline: 'middle',
    };

    return [textGeometry];
  }

  testHit(point: Point, viewport: Viewport): boolean {
    if (!this.isValid()) return false;

    // Check if near anchor point
    const anchorPos = this.anchorToPixel(this._anchors[0], viewport);
    if (anchorPos) {
      const dx = point.x - anchorPos.x;
      const dy = point.y - anchorPos.y;
      if (Math.sqrt(dx * dx + dy * dy) <= AnchoredText.HIT_THRESHOLD) {
        return true;
      }
    }

    // Check if near text box
    const textPos = this.anchorToPixel(this._anchors[1], viewport);
    if (!textPos) return false;

    const estimatedWidth = (this._textOptions.text?.length ?? 0) * (this._textOptions.fontSize ?? 12) * 0.6;
    const estimatedHeight = (this._textOptions.fontSize ?? 12) * 1.5;
    const padding = 6;

    return (
      point.x >= textPos.x - padding &&
      point.x <= textPos.x + estimatedWidth + padding &&
      point.y >= textPos.y - estimatedHeight / 2 - padding &&
      point.y <= textPos.y + estimatedHeight / 2 + padding
    );
  }

  clone(newId: string): IDrawing {
    return new AnchoredText(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._textOptions }
    );
  }

  static create(
    id: string,
    anchorPoint: Anchor,
    textPoint: Anchor,
    text: string,
    style?: Partial<DrawingStyle>,
    options?: Partial<AnchoredTextOptions>
  ): AnchoredText {
    return new AnchoredText(id, [anchorPoint, textPoint], style, { ...options, text });
  }
}
