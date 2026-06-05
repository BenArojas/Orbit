import type { Anchor, Point, DrawingStyle, Viewport } from '../core/types';
import { drawLine, drawDashedLine, drawControlPoint } from './canvas-utils';

/**
 * Interface for preview renderers
 */
export interface IPreviewRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    anchors: Anchor[],
    previewAnchor: Anchor | null,
    viewport: Viewport,
    style: DrawingStyle,
    pixelRatio: number
  ): void;
}

/**
 * Base preview renderer with common functionality
 */
export abstract class PreviewRenderer implements IPreviewRenderer {
  abstract render(
    ctx: CanvasRenderingContext2D,
    anchors: Anchor[],
    previewAnchor: Anchor | null,
    viewport: Viewport,
    style: DrawingStyle,
    pixelRatio: number
  ): void;

  protected anchorToPixel(anchor: Anchor, viewport: Viewport): Point | null {
    const x = viewport.timeScale.timeToCoordinate(anchor.time);
    const y = viewport.priceScale.priceToCoordinate(anchor.price);

    if (x === null || y === null) return null;

    return { x, y };
  }

  protected drawAnchorPoint(
    ctx: CanvasRenderingContext2D,
    point: Point,
    pixelRatio: number
  ): void {
    drawControlPoint(
      ctx,
      { index: 0, x: point.x, y: point.y, radius: 5 },
      true,
      pixelRatio
    );
  }
}

/**
 * Preview renderer for two-point line drawings
 */
export class LinePreviewRenderer extends PreviewRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    anchors: Anchor[],
    previewAnchor: Anchor | null,
    viewport: Viewport,
    style: DrawingStyle,
    pixelRatio: number
  ): void {
    if (anchors.length === 0) return;

    // Convert first anchor to pixel
    const startPoint = this.anchorToPixel(anchors[0], viewport);
    if (!startPoint) return;

    // Draw first anchor point
    this.drawAnchorPoint(ctx, startPoint, pixelRatio);

    // If we have a preview anchor, draw the preview line
    if (previewAnchor) {
      const endPoint = this.anchorToPixel(previewAnchor, viewport);
      if (!endPoint) return;

      // Set up style for preview (dashed)
      ctx.strokeStyle = style.lineColor;
      ctx.lineWidth = style.lineWidth * pixelRatio;
      ctx.globalAlpha = 0.7;

      // Draw dashed preview line
      drawDashedLine(ctx, startPoint, endPoint, [5, 5], pixelRatio);

      // Draw preview endpoint
      this.drawAnchorPoint(ctx, endPoint, pixelRatio);

      ctx.globalAlpha = 1;
    }
  }
}

/**
 * Preview renderer for horizontal line (single point)
 */
export class HorizontalLinePreviewRenderer extends PreviewRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    anchors: Anchor[],
    previewAnchor: Anchor | null,
    viewport: Viewport,
    style: DrawingStyle,
    pixelRatio: number
  ): void {
    const anchor = anchors[0] || previewAnchor;
    if (!anchor) return;

    const point = this.anchorToPixel(anchor, viewport);
    if (!point) return;

    ctx.strokeStyle = style.lineColor;
    ctx.lineWidth = style.lineWidth * pixelRatio;
    ctx.globalAlpha = anchors.length === 0 ? 0.5 : 0.7;

    // Draw horizontal line across viewport
    const startPoint: Point = { x: 0, y: point.y };
    const endPoint: Point = { x: viewport.width, y: point.y };

    if (anchors.length === 0) {
      drawDashedLine(ctx, startPoint, endPoint, [5, 5], pixelRatio);
    } else {
      drawLine(ctx, startPoint, endPoint, pixelRatio);
    }

    // Draw anchor point
    this.drawAnchorPoint(ctx, point, pixelRatio);

    ctx.globalAlpha = 1;
  }
}

/**
 * Preview renderer for vertical line (single point)
 */
export class VerticalLinePreviewRenderer extends PreviewRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    anchors: Anchor[],
    previewAnchor: Anchor | null,
    viewport: Viewport,
    style: DrawingStyle,
    pixelRatio: number
  ): void {
    const anchor = anchors[0] || previewAnchor;
    if (!anchor) return;

    const point = this.anchorToPixel(anchor, viewport);
    if (!point) return;

    ctx.strokeStyle = style.lineColor;
    ctx.lineWidth = style.lineWidth * pixelRatio;
    ctx.globalAlpha = anchors.length === 0 ? 0.5 : 0.7;

    // Draw vertical line across viewport
    const startPoint: Point = { x: point.x, y: 0 };
    const endPoint: Point = { x: point.x, y: viewport.height };

    if (anchors.length === 0) {
      drawDashedLine(ctx, startPoint, endPoint, [5, 5], pixelRatio);
    } else {
      drawLine(ctx, startPoint, endPoint, pixelRatio);
    }

    // Draw anchor point
    this.drawAnchorPoint(ctx, point, pixelRatio);

    ctx.globalAlpha = 1;
  }
}

/**
 * Preview renderer for three-point drawings (channels, pitchforks)
 */
export class ThreePointPreviewRenderer extends PreviewRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    anchors: Anchor[],
    previewAnchor: Anchor | null,
    viewport: Viewport,
    style: DrawingStyle,
    pixelRatio: number
  ): void {
    if (anchors.length === 0) return;

    const points: Point[] = [];

    // Convert all anchors to pixels
    for (const anchor of anchors) {
      const point = this.anchorToPixel(anchor, viewport);
      if (point) points.push(point);
    }

    // Add preview anchor if present
    if (previewAnchor) {
      const previewPoint = this.anchorToPixel(previewAnchor, viewport);
      if (previewPoint) points.push(previewPoint);
    }

    if (points.length === 0) return;

    ctx.strokeStyle = style.lineColor;
    ctx.lineWidth = style.lineWidth * pixelRatio;
    ctx.globalAlpha = 0.7;

    // Draw lines connecting points
    for (let i = 0; i < points.length - 1; i++) {
      if (i === points.length - 2 && previewAnchor) {
        // Last segment is preview
        drawDashedLine(ctx, points[i], points[i + 1], [5, 5], pixelRatio);
      } else {
        drawLine(ctx, points[i], points[i + 1], pixelRatio);
      }
    }

    // Draw anchor points
    for (const point of points) {
      this.drawAnchorPoint(ctx, point, pixelRatio);
    }

    ctx.globalAlpha = 1;
  }
}
