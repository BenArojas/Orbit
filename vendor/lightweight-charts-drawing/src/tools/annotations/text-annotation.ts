import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry, TextGeometry } from '../../core/geometry';
import { TextAnnotationPaneView } from './text-annotation-pane-view';

/**
 * TextAnnotation options
 */
export interface TextAnnotationOptions extends DrawingOptions {
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  textAlign?: CanvasTextAlign;
  backgroundColor?: string;
  borderColor?: string;
  padding?: number;
}

/**
 * TextAnnotation - A text label placed on the chart.
 *
 * Features:
 * - Single anchor point (position)
 * - Customizable text, font, alignment
 * - Optional background and border
 */
export class TextAnnotation extends Drawing {
  readonly type = 'text-annotation';

  protected static readonly REQUIRED_ANCHORS = 1;
  protected static readonly HIT_THRESHOLD = 10;

  private _textOptions: TextAnnotationOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<TextAnnotationOptions> = {}
  ) {
    const { text, fontSize, fontFamily, fontWeight, textAlign, backgroundColor, borderColor, padding, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._textOptions = {
      ...this._options,
      text: text ?? 'Text',
      fontSize: fontSize ?? 14,
      fontFamily: fontFamily ?? 'sans-serif',
      fontWeight: fontWeight ?? 'normal',
      textAlign: textAlign ?? 'left',
      backgroundColor: backgroundColor ?? 'rgba(255, 255, 255, 0.9)',
      borderColor: borderColor ?? this._style.lineColor,
      padding: padding ?? 8,
    };
  }

  get textOptions(): TextAnnotationOptions {
    return this._textOptions;
  }

  setTextOptions(options: Partial<TextAnnotationOptions>): void {
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
    return this._anchors.length >= TextAnnotation.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new TextAnnotationPaneView(this)];
  }

  computeGeometry(viewport: Viewport): Geometry[] {
    if (!this.isValid()) return [];

    const p = this.anchorToPixel(this._anchors[0], viewport);
    if (!p) return [];

    const textGeometry: TextGeometry = {
      type: 'text',
      position: p,
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

    const p = this.anchorToPixel(this._anchors[0], viewport);
    if (!p) return false;

    // Approximate hit box based on text dimensions
    const estimatedWidth = (this._textOptions.text?.length ?? 0) * (this._textOptions.fontSize ?? 14) * 0.6;
    const estimatedHeight = (this._textOptions.fontSize ?? 14) * 1.5;
    const padding = this._textOptions.padding ?? 8;

    return (
      point.x >= p.x - padding &&
      point.x <= p.x + estimatedWidth + padding &&
      point.y >= p.y - estimatedHeight / 2 - padding &&
      point.y <= p.y + estimatedHeight / 2 + padding
    );
  }

  clone(newId: string): IDrawing {
    return new TextAnnotation(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._textOptions }
    );
  }

  static create(
    id: string,
    position: Anchor,
    text: string,
    style?: Partial<DrawingStyle>,
    options?: Partial<TextAnnotationOptions>
  ): TextAnnotation {
    return new TextAnnotation(id, [position], style, { ...options, text });
  }
}
