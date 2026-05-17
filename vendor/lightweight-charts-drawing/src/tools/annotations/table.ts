import type { IPrimitivePaneView } from 'lightweight-charts';

import { Drawing } from '../../core/drawing';
import type { Anchor, Point, Viewport, DrawingStyle, DrawingOptions, IDrawing } from '../../core/types';
import type { Geometry } from '../../core/geometry';
import { TablePaneView } from './table-pane-view';

/**
 * Table options
 */
export interface TableOptions extends DrawingOptions {
  rows?: string[][];
  headerRow?: boolean;
  fontSize?: number;
  backgroundColor?: string;
  headerColor?: string;
  textColor?: string;
  borderColor?: string;
  cellPadding?: number;
}

const DEFAULT_TABLE_DATA: string[][] = [
  ['Label', 'Value'],
  ['Price', '0.00'],
  ['Change', '0.00%'],
];

/**
 * Table - A data table annotation.
 *
 * Features:
 * - Single anchor point (top-left corner)
 * - Configurable rows and columns
 * - Optional header row with distinct styling
 */
export class Table extends Drawing {
  readonly type = 'table';

  protected static readonly REQUIRED_ANCHORS = 1;
  protected static readonly HIT_THRESHOLD = 5;

  private _tableOptions: TableOptions;

  constructor(
    id: string,
    anchors: Anchor[] = [],
    style: Partial<DrawingStyle> = {},
    options: Partial<TableOptions> = {}
  ) {
    const { rows, headerRow, fontSize, backgroundColor, headerColor, textColor, borderColor, cellPadding, ...baseOptions } = options;
    super(id, anchors, style, baseOptions);

    this._tableOptions = {
      ...this._options,
      rows: rows ?? DEFAULT_TABLE_DATA.map(r => [...r]),
      headerRow: headerRow ?? true,
      fontSize: fontSize ?? 11,
      backgroundColor: backgroundColor ?? '#1e222d',
      headerColor: headerColor ?? '#2a2e39',
      textColor: textColor ?? '#d1d4dc',
      borderColor: borderColor ?? '#363a45',
      cellPadding: cellPadding ?? 6,
    };
  }

  get tableOptions(): TableOptions {
    return this._tableOptions;
  }

  setTableOptions(options: Partial<TableOptions>): void {
    this._tableOptions = { ...this._tableOptions, ...options };
    this.requestUpdate();
  }

  setRows(rows: string[][]): void {
    this._tableOptions.rows = rows;
    this.requestUpdate();
  }

  getRows(): string[][] {
    return this._tableOptions.rows ?? [];
  }

  isValid(): boolean {
    return this._anchors.length >= Table.REQUIRED_ANCHORS;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new TablePaneView(this)];
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

    const rows = this._tableOptions.rows ?? [];
    const cols = rows.length > 0 ? rows[0].length : 0;
    const cellPadding = this._tableOptions.cellPadding ?? 6;
    const fontSize = this._tableOptions.fontSize ?? 11;
    const rowHeight = fontSize + cellPadding * 2;
    const colWidth = 80;

    const tableWidth = cols * colWidth;
    const tableHeight = rows.length * rowHeight;

    return (
      point.x >= p.x &&
      point.x <= p.x + tableWidth &&
      point.y >= p.y &&
      point.y <= p.y + tableHeight
    );
  }

  clone(newId: string): IDrawing {
    return new Table(
      newId,
      [...this._anchors],
      { ...this._style },
      {
        ...this._tableOptions,
        rows: (this._tableOptions.rows ?? []).map(r => [...r]),
      }
    );
  }

  static create(
    id: string,
    position: Anchor,
    rows?: string[][],
    style?: Partial<DrawingStyle>,
    options?: Partial<TableOptions>
  ): Table {
    return new Table(id, [position], style, { ...options, rows });
  }
}
