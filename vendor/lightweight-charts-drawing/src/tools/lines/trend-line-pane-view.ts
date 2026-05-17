import type {
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
} from 'lightweight-charts';
import type {
  CanvasRenderingTarget2D,
  BitmapCoordinatesRenderingScope,
} from 'fancy-canvas';

import type { TrendLine } from './trend-line';
import type { Point, Viewport } from '../../core/types';
import { extendLineToViewport, midpoint, getLineAngleDegrees } from '../../core/geometry';
import { applyStyle, drawLine, drawControlPoints, drawLabel } from '../../rendering/canvas-utils';

/**
 * Specialized pane view for TrendLine with label support
 */
export class TrendLinePaneView implements IPrimitivePaneView {
  private _renderer: TrendLinePaneRenderer;

  constructor(drawing: TrendLine) {
    this._renderer = new TrendLinePaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

/**
 * Renderer for TrendLine
 */
class TrendLinePaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: TrendLine;

  constructor(drawing: TrendLine) {
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

    // Get viewport
    const viewport = this._drawing.getViewport();
    if (!viewport) return;

    // Check visibility
    if (!this._drawing.options.visible) return;

    // Check validity
    if (!this._drawing.isValid()) return;

    // Get anchor points
    const anchors = this._drawing.anchors;
    const start = this._drawing.anchorToPixel(anchors[0], viewport);
    const end = this._drawing.anchorToPixel(anchors[1], viewport);

    if (!start || !end) return;

    // Apply style
    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Render line with extensions
    this.renderLine(ctx, start, end, viewport, pixelRatio);

    // Render labels if enabled
    this.renderLabels(ctx, start, end, pixelRatio);

    // Draw control points if selected, editing, or hovered
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing' || state === 'hovered') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio, this._drawing.style.lineColor);
    }
  }

  private renderLine(
    ctx: CanvasRenderingContext2D,
    start: Point,
    end: Point,
    viewport: Viewport,
    pixelRatio: number
  ): void {
    let drawStart = start;
    let drawEnd = end;

    const options = this._drawing.options;

    // Extend line if needed
    if (options.extendLeft || options.extendRight) {
      const extended = extendLineToViewport(
        start,
        end,
        viewport.width,
        viewport.height,
        options.extendLeft ?? false,
        options.extendRight ?? false
      );
      drawStart = extended.start;
      drawEnd = extended.end;
    }

    drawLine(ctx, drawStart, drawEnd, pixelRatio);
  }

  private renderLabels(
    ctx: CanvasRenderingContext2D,
    start: Point,
    end: Point,
    pixelRatio: number
  ): void {
    const options = this._drawing.trendLineOptions;

    if (!options.showAngle &&
        !options.showPriceChange &&
        !options.showPercentChange &&
        !options.showBars) {
      return;
    }

    // Calculate label parts
    const labelParts: string[] = [];

    if (options.showAngle) {
      const angle = getLineAngleDegrees(start, end);
      labelParts.push(`${angle.toFixed(1)}°`);
    }

    if (options.showPriceChange) {
      const { absolute } = this._drawing.getPriceChange();
      const sign = absolute >= 0 ? '+' : '';
      labelParts.push(`${sign}${absolute.toFixed(2)}`);
    }

    if (options.showPercentChange) {
      const { percentage } = this._drawing.getPriceChange();
      const sign = percentage >= 0 ? '+' : '';
      labelParts.push(`${sign}${percentage.toFixed(2)}%`);
    }

    if (options.showBars) {
      const bars = this._drawing.getTimeSpan();
      labelParts.push(`${bars} bars`);
    }

    if (labelParts.length === 0) return;

    // Position label at midpoint, above the line
    const labelPosition = midpoint(start, end);
    const offset = 20;

    // Determine if line goes up or down to position label appropriately
    const goesUp = end.y < start.y;
    const labelY = goesUp ? labelPosition.y - offset : labelPosition.y + offset;

    const text = labelParts.join(' | ');

    drawLabel(
      ctx,
      text,
      { x: labelPosition.x, y: labelY },
      {
        font: this._drawing.style.labelFont || '12px sans-serif',
        textColor: '#ffffff',
        backgroundColor: this._drawing.style.lineColor + 'CC',
        padding: 4,
        borderRadius: 3,
      },
      pixelRatio
    );
  }
}
