import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry } from '../../core/geometry';
import { PriceNotePaneView } from './price-note-pane-view';

/**
 * Price Note options
 */
export interface PriceNoteOptions extends DrawingOptions {
  note?: string;
  showPrice?: boolean;
  showTime?: boolean;
  fontSize?: number;
  backgroundColor?: string;
  priceColor?: string;
  noteColor?: string;
}

/**
 * Price Note - Displays price and optional note at a specific point.
 *
 * Features:
 * - Single anchor point
 * - Shows price value
 * - Optional note text
 * - Customizable colors
 */
export class PriceNote extends Drawing {
  readonly type = 'price-note';

  protected static readonly REQUIRED_ANCHORS = 1;
  protected static readonly HIT_THRESHOLD = 10;

  private _noteOptions: PriceNoteOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<PriceNoteOptions> = {}
  ) {
    const { note, showPrice, showTime, fontSize, backgroundColor, priceColor, noteColor, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._noteOptions = {
      ...this._options,
      note: note ?? '',
      showPrice: showPrice ?? true,
      showTime: showTime ?? false,
      fontSize: fontSize ?? 11,
      backgroundColor: backgroundColor ?? 'rgba(30, 34, 45, 0.95)',
      priceColor: priceColor ?? '#26a69a',
      noteColor: noteColor ?? '#d1d4dc',
    };
  }

  get noteOptions(): PriceNoteOptions {
    return this._noteOptions;
  }

  setNoteOptions(options: Partial<PriceNoteOptions>): void {
    this._noteOptions = { ...this._noteOptions, ...options };
    this.requestUpdate();
  }

  setNote(note: string): void {
    this._noteOptions.note = note;
    this.requestUpdate();
  }

  getNote(): string {
    return this._noteOptions.note ?? '';
  }

  getPrice(): number {
    return this._anchors[0]?.price ?? 0;
  }

  isValid(): boolean {
    return this._anchors.length >= PriceNote.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new PriceNotePaneView(this)];
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

    const width = 80;
    const height = 40;

    return (
      point.x >= p.x - 10 &&
      point.x <= p.x + width &&
      point.y >= p.y - height / 2 &&
      point.y <= p.y + height / 2
    );
  }

  clone(newId: string): IDrawing {
    return new PriceNote(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._noteOptions }
    );
  }

  static create(
    id: string,
    position: Anchor,
    note?: string,
    style?: Partial<DrawingStyle>,
    options?: Partial<PriceNoteOptions>
  ): PriceNote {
    return new PriceNote(id, [position], style, { ...options, note });
  }
}
