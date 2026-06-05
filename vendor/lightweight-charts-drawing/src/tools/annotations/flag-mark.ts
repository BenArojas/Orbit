import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry } from '../../core/geometry';
import { FlagMarkPaneView } from './flag-mark-pane-view';

/**
 * Flag mark color type
 */
export type FlagColor = 'red' | 'green' | 'blue' | 'yellow' | 'purple' | 'custom';

/**
 * Flag Mark options
 */
export interface FlagMarkOptions extends DrawingOptions {
  flagColor?: FlagColor;
  customColor?: string;
  label?: string;
  size?: number;
}

/**
 * Flag Mark - A flag marker placed on the chart.
 *
 * Features:
 * - Single anchor point
 * - Various preset colors
 * - Optional label
 * - Configurable size
 */
export class FlagMark extends Drawing {
  readonly type = 'flag-mark';

  protected static readonly REQUIRED_ANCHORS = 1;
  protected static readonly HIT_THRESHOLD = 15;

  private _flagOptions: FlagMarkOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<FlagMarkOptions> = {}
  ) {
    const { flagColor, customColor, label, size, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._flagOptions = {
      ...this._options,
      flagColor: flagColor ?? 'red',
      customColor: customColor ?? '#FF0000',
      label: label ?? '',
      size: size ?? 20,
    };
  }

  get flagOptions(): FlagMarkOptions {
    return this._flagOptions;
  }

  setFlagOptions(options: Partial<FlagMarkOptions>): void {
    this._flagOptions = { ...this._flagOptions, ...options };
    this.requestUpdate();
  }

  getFlagColor(): string {
    const colors: Record<FlagColor, string> = {
      red: '#ef5350',
      green: '#26a69a',
      blue: '#2196F3',
      yellow: '#FFEB3B',
      purple: '#9C27B0',
      custom: this._flagOptions.customColor ?? '#FF0000',
    };
    return colors[this._flagOptions.flagColor ?? 'red'];
  }

  setLabel(label: string): void {
    this._flagOptions.label = label;
    this.requestUpdate();
  }

  getLabel(): string {
    return this._flagOptions.label ?? '';
  }

  isValid(): boolean {
    return this._anchors.length >= FlagMark.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new FlagMarkPaneView(this)];
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

    const size = this._flagOptions.size ?? 20;

    // Check if near the flag
    return (
      point.x >= p.x - 5 &&
      point.x <= p.x + size + 5 &&
      point.y >= p.y - size * 1.5 &&
      point.y <= p.y + 5
    );
  }

  clone(newId: string): IDrawing {
    return new FlagMark(
      newId,
      [...this._anchors],
      { ...this._style },
      { ...this._flagOptions }
    );
  }

  static create(
    id: string,
    position: Anchor,
    flagColor?: FlagColor,
    label?: string,
    style?: Partial<DrawingStyle>,
    options?: Partial<FlagMarkOptions>
  ): FlagMark {
    return new FlagMark(id, [position], style, { ...options, flagColor, label });
  }
}
