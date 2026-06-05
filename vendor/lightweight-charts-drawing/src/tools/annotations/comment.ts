import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry } from '../../core/geometry';
import { CommentPaneView } from './comment-pane-view';

/**
 * Comment options
 */
export interface CommentOptions extends DrawingOptions {
  text?: string;
  fontSize?: number;
  backgroundColor?: string;
  textColor?: string;
}

/**
 * Comment - A speech-bubble style comment marker.
 *
 * Features:
 * - Single anchor point
 * - Speech bubble with text
 * - Customizable colors
 */
export class Comment extends Drawing {
  readonly type = 'comment';

  protected static readonly REQUIRED_ANCHORS = 1;
  protected static readonly HIT_THRESHOLD = 15;

  private _commentOptions: CommentOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<CommentOptions> = {}
  ) {
    const { text, fontSize, backgroundColor, textColor, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._commentOptions = {
      ...this._options,
      text: text ?? 'Comment',
      fontSize: fontSize ?? 11,
      backgroundColor: backgroundColor ?? '#2962FF',
      textColor: textColor ?? '#FFFFFF',
    };
  }

  get commentOptions(): CommentOptions {
    return this._commentOptions;
  }

  setCommentOptions(options: Partial<CommentOptions>): void {
    this._commentOptions = { ...this._commentOptions, ...options };
    this.requestUpdate();
  }

  setText(text: string): void {
    this._commentOptions.text = text;
    this.requestUpdate();
  }

  getText(): string {
    return this._commentOptions.text ?? '';
  }

  isValid(): boolean {
    return this._anchors.length >= Comment.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new CommentPaneView(this)];
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

    const width = 130;
    const height = 50;

    return (
      point.x >= p.x &&
      point.x <= p.x + width &&
      point.y >= p.y - height - 10 &&
      point.y <= p.y
    );
  }

  clone(newId: string): IDrawing {
    return new Comment(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._commentOptions }
    );
  }

  static create(
    id: string,
    position: Anchor,
    text: string,
    style?: Partial<DrawingStyle>,
    options?: Partial<CommentOptions>
  ): Comment {
    return new Comment(id, [position], style, { ...options, text });
  }
}
