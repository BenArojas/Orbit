import type {
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
} from 'lightweight-charts';
import type {
  CanvasRenderingTarget2D,
  BitmapCoordinatesRenderingScope,
} from 'fancy-canvas';

import type { Drawing } from '../core/drawing';
import type { Point, Viewport } from '../core/types';
import type { Geometry, LineGeometry } from '../core/geometry';
import { extendLineToViewport } from '../core/geometry';
import { applyStyle, drawLine, drawControlPoints } from './canvas-utils';

/**
 * Pane view implementation for Drawing primitives
 */
export class DrawingPaneView implements IPrimitivePaneView {
  private _renderer: DrawingPaneRenderer;

  constructor(drawing: Drawing) {
    this._renderer = new DrawingPaneRenderer(drawing);
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

/**
 * Pane renderer for Drawing primitives
 */
class DrawingPaneRenderer implements IPrimitivePaneRenderer {
  private _drawing: Drawing;

  constructor(drawing: Drawing) {
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

    // Compute geometry
    const geometries = this._drawing.computeGeometry(viewport);

    // Apply style
    applyStyle(ctx, this._drawing.style, pixelRatio);

    // Render each geometry
    for (const geometry of geometries) {
      this.renderGeometry(ctx, geometry, viewport, pixelRatio);
    }

    // Draw control points if selected, editing, or hovered
    const state = this._drawing.state;
    if (state === 'selected' || state === 'editing' || state === 'hovered') {
      const controlPoints = this._drawing.getControlPoints(viewport);
      drawControlPoints(ctx, controlPoints, null, pixelRatio, this._drawing.style.lineColor);
    }
  }

  private renderGeometry(
    ctx: CanvasRenderingContext2D,
    geometry: Geometry,
    viewport: Viewport,
    pixelRatio: number
  ): void {
    switch (geometry.type) {
      case 'line':
        this.renderLine(ctx, geometry, viewport, pixelRatio);
        break;
      case 'arc':
        this.renderArc(ctx, geometry, pixelRatio);
        break;
      case 'rectangle':
        this.renderRectangle(ctx, geometry, pixelRatio);
        break;
      case 'polygon':
        this.renderPolygon(ctx, geometry, pixelRatio);
        break;
      case 'text':
        this.renderText(ctx, geometry, pixelRatio);
        break;
    }
  }

  private renderLine(
    ctx: CanvasRenderingContext2D,
    line: LineGeometry,
    viewport: Viewport,
    pixelRatio: number
  ): void {
    let start = line.start;
    let end = line.end;

    // Handle line extensions
    if (line.extendLeft || line.extendRight) {
      const extended = extendLineToViewport(
        start,
        end,
        viewport.width,
        viewport.height,
        line.extendLeft ?? false,
        line.extendRight ?? false
      );
      start = extended.start;
      end = extended.end;
    }

    drawLine(ctx, start, end, pixelRatio);
  }

  private renderArc(
    ctx: CanvasRenderingContext2D,
    arc: { center: Point; radius: number; startAngle: number; endAngle: number; counterClockwise?: boolean },
    pixelRatio: number
  ): void {
    ctx.beginPath();
    ctx.arc(
      arc.center.x * pixelRatio,
      arc.center.y * pixelRatio,
      arc.radius * pixelRatio,
      arc.startAngle,
      arc.endAngle,
      arc.counterClockwise
    );
    ctx.stroke();
  }

  private renderRectangle(
    ctx: CanvasRenderingContext2D,
    rect: { topLeft: Point; width: number; height: number; rotation?: number },
    pixelRatio: number
  ): void {
    const x = rect.topLeft.x * pixelRatio;
    const y = rect.topLeft.y * pixelRatio;
    const w = rect.width * pixelRatio;
    const h = rect.height * pixelRatio;

    if (rect.rotation) {
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(rect.rotation);
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    } else {
      ctx.strokeRect(x, y, w, h);
    }
  }

  private renderPolygon(
    ctx: CanvasRenderingContext2D,
    polygon: { points: Point[]; closed: boolean },
    pixelRatio: number
  ): void {
    if (polygon.points.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(polygon.points[0].x * pixelRatio, polygon.points[0].y * pixelRatio);

    for (let i = 1; i < polygon.points.length; i++) {
      ctx.lineTo(polygon.points[i].x * pixelRatio, polygon.points[i].y * pixelRatio);
    }

    if (polygon.closed) {
      ctx.closePath();
      ctx.fill();
    }
    ctx.stroke();
  }

  private renderText(
    ctx: CanvasRenderingContext2D,
    text: { position: Point; text: string; font?: string; color?: string; align?: CanvasTextAlign; baseline?: CanvasTextBaseline; rotation?: number },
    pixelRatio: number
  ): void {
    ctx.save();

    if (text.font) ctx.font = text.font;
    if (text.color) ctx.fillStyle = text.color;
    if (text.align) ctx.textAlign = text.align;
    if (text.baseline) ctx.textBaseline = text.baseline;

    const x = text.position.x * pixelRatio;
    const y = text.position.y * pixelRatio;

    if (text.rotation) {
      ctx.translate(x, y);
      ctx.rotate(text.rotation);
      ctx.fillText(text.text, 0, 0);
    } else {
      ctx.fillText(text.text, x, y);
    }

    ctx.restore();
  }
}
