import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry } from '../../core/geometry';
import { NotePaneView } from './note-pane-view';

/**
 * Note options
 */
export interface NoteOptions extends DrawingOptions {
  text?: string;
  fontSize?: number;
  backgroundColor?: string;
  iconColor?: string;
  width?: number;
  showIcon?: boolean;
}

/**
 * Note - A sticky note style annotation.
 *
 * Features:
 * - Single anchor point
 * - Note icon with expandable text
 * - Customizable background and icon color
 * - Fixed or auto-width
 */
export class Note extends Drawing {
  readonly type = 'note';

  protected static readonly REQUIRED_ANCHORS = 1;
  protected static readonly HIT_THRESHOLD = 15;

  private _noteOptions: NoteOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<NoteOptions> = {}
  ) {
    const { text, fontSize, backgroundColor, iconColor, width, showIcon, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._noteOptions = {
      ...this._options,
      text: text ?? 'Note',
      fontSize: fontSize ?? 11,
      backgroundColor: backgroundColor ?? '#FFEB3B',
      iconColor: iconColor ?? '#000000',
      width: width ?? 120,
      showIcon: showIcon ?? true,
    };
  }

  get noteOptions(): NoteOptions {
    return this._noteOptions;
  }

  setNoteOptions(options: Partial<NoteOptions>): void {
    this._noteOptions = { ...this._noteOptions, ...options };
    this.requestUpdate();
  }

  setText(text: string): void {
    this._noteOptions.text = text;
    this.requestUpdate();
  }

  getText(): string {
    return this._noteOptions.text ?? '';
  }

  isValid(): boolean {
    return this._anchors.length >= Note.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new NotePaneView(this)];
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

    const width = this._noteOptions.width ?? 120;
    const height = 60; // Approximate height

    return (
      point.x >= p.x &&
      point.x <= p.x + width &&
      point.y >= p.y &&
      point.y <= p.y + height
    );
  }

  clone(newId: string): IDrawing {
    return new Note(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._noteOptions }
    );
  }

  static create(
    id: string,
    position: Anchor,
    text: string,
    style?: Partial<DrawingStyle>,
    options?: Partial<NoteOptions>
  ): Note {
    return new Note(id, [position], style, { ...options, text });
  }
}
