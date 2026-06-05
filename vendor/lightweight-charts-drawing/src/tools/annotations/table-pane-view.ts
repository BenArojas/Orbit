import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import type { Table } from './table';
import { drawControlPoints } from '../../rendering/canvas-utils';

export class TablePaneView implements IPrimitivePaneView {
  private _renderer: TablePaneRenderer;

  constructor(drawing: Table) {
    this._renderer = new TablePaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

class TablePaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: Table;

  constructor(drawing: Table) {
    this._drawing = drawing;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace((scope: BitmapCoordinatesRenderingScope) => {
      this.drawImpl(scope);
    });
  }

  private drawImpl(scope: BitmapCoordinatesRenderingScope): void {
    const { context: ctx, horizontalPixelRatio } = scope;
    const pixelRatio = horizontalPixelRatio;

    const viewport = this._drawing.getViewport();
    if (!viewport) return;
    if (!this._drawing.options.visible) return;
    if (!this._drawing.isValid()) return;

    const anchor = this._drawing.anchors[0];
    const p = this._drawing.anchorToPixel(anchor, viewport);
    if (!p) return;

    const options = this._drawing.tableOptions;
    const rows = options.rows ?? [];
    if (rows.length === 0) return;

    const fontSize = (options.fontSize ?? 11) * pixelRatio;
    const bgColor = options.backgroundColor ?? '#1e222d';
    const headerColor = options.headerColor ?? '#2a2e39';
    const textColor = options.textColor ?? '#d1d4dc';
    const borderColor = options.borderColor ?? '#363a45';
    const cellPadding = (options.cellPadding ?? 6) * pixelRatio;
    const hasHeader = options.headerRow ?? true;

    const x = p.x * pixelRatio;
    const y = p.y * pixelRatio;

    ctx.save();

    // Measure column widths
    ctx.font = `${fontSize}px sans-serif`;
    const cols = rows[0].length;
    const colWidths: number[] = new Array(cols).fill(0);

    for (const row of rows) {
      for (let c = 0; c < row.length && c < cols; c++) {
        const w = ctx.measureText(row[c]).width + cellPadding * 2;
        colWidths[c] = Math.max(colWidths[c], w);
      }
    }

    // Ensure minimum column width
    for (let c = 0; c < cols; c++) {
      colWidths[c] = Math.max(colWidths[c], 50 * pixelRatio);
    }

    const rowHeight = fontSize + cellPadding * 2;
    const tableWidth = colWidths.reduce((s, w) => s + w, 0);
    const tableHeight = rows.length * rowHeight;

    // Draw table background
    ctx.fillStyle = bgColor;
    ctx.fillRect(x, y, tableWidth, tableHeight);

    // Draw rows
    for (let r = 0; r < rows.length; r++) {
      const rowY = y + r * rowHeight;

      // Header row background
      if (r === 0 && hasHeader) {
        ctx.fillStyle = headerColor;
        ctx.fillRect(x, rowY, tableWidth, rowHeight);
      }

      // Draw cells
      let cellX = x;
      for (let c = 0; c < cols; c++) {
        const cellText = (r < rows.length && c < rows[r].length) ? rows[r][c] : '';

        // Cell text
        ctx.fillStyle = textColor;
        ctx.font = (r === 0 && hasHeader)
          ? `bold ${fontSize}px sans-serif`
          : `${fontSize}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(cellText, cellX + cellPadding, rowY + rowHeight / 2);

        // Vertical border
        if (c > 0) {
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = 1 * pixelRatio;
          ctx.beginPath();
          ctx.moveTo(cellX, rowY);
          ctx.lineTo(cellX, rowY + rowHeight);
          ctx.stroke();
        }

        cellX += colWidths[c];
      }

      // Horizontal border
      if (r > 0) {
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1 * pixelRatio;
        ctx.beginPath();
        ctx.moveTo(x, rowY);
        ctx.lineTo(x + tableWidth, rowY);
        ctx.stroke();
      }
    }

    // Draw outer border
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1 * pixelRatio;
    ctx.strokeRect(x, y, tableWidth, tableHeight);

    ctx.restore();

    // Draw control points if selected
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio);
    }
  }
}
