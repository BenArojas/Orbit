/**
 * Re-export shim for the vendored lightweight-charts-drawing library.
 *
 * The rest of the app imports from "@/lib/drawings", never directly from
 * vendor/. This isolates the dependency: a future replacement or fork is
 * a single-file change here.
 *
 * Vendored at: vendor/lightweight-charts-drawing/
 * Upstream:    https://github.com/deepentropy/lightweight-charts-drawing
 * Tag:         v0.1.1
 * Commit SHA:  778f1e5cf3d62c2499dd4c686a00ab66bb01c44f
 */

export {
  DrawingManager,
  HorizontalLine,
  TrendLine,
  Ray,
  Rectangle,
  VerticalLine,
  TextAnnotation,
  LongPosition,
  ShortPosition,
  Forecast,
  BarsPattern,
  ToolRegistry,
  getToolRegistry,
} from "@vendor/lightweight-charts-drawing";

// Re-export core types used throughout the integration layer.
export type {
  Drawing,
  Anchor,
  DrawingStyle,
  DrawingOptions,
  DrawingState,
  SerializedDrawing,
  DrawingEvent,
  DrawingEventCallback,
  DrawingEventType,
  IDrawing,
} from "@vendor/lightweight-charts-drawing";
