import type { Point } from './types';

/**
 * Line geometry with optional extensions
 */
export interface LineGeometry {
  type: 'line';
  start: Point;
  end: Point;
  extendLeft?: boolean;
  extendRight?: boolean;
}

/**
 * Arc/circle geometry
 */
export interface ArcGeometry {
  type: 'arc';
  center: Point;
  radius: number;
  startAngle: number;
  endAngle: number;
  counterClockwise?: boolean;
}

/**
 * Rectangle geometry
 */
export interface RectangleGeometry {
  type: 'rectangle';
  topLeft: Point;
  width: number;
  height: number;
  rotation?: number;
}

/**
 * Polygon geometry (closed or open path)
 */
export interface PolygonGeometry {
  type: 'polygon';
  points: Point[];
  closed: boolean;
}

/**
 * Text geometry
 */
export interface TextGeometry {
  type: 'text';
  position: Point;
  text: string;
  font?: string;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  rotation?: number;
}

/**
 * Union of all geometry types
 */
export type Geometry =
  | LineGeometry
  | ArcGeometry
  | RectangleGeometry
  | PolygonGeometry
  | TextGeometry;

/**
 * Calculate distance from point to line segment
 */
export function distanceToLineSegment(
  point: Point,
  lineStart: Point,
  lineEnd: Point
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    // Line segment is a point
    const ex = point.x - lineStart.x;
    const ey = point.y - lineStart.y;
    return Math.sqrt(ex * ex + ey * ey);
  }

  // Project point onto line, clamping to segment
  let t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));

  const projectionX = lineStart.x + t * dx;
  const projectionY = lineStart.y + t * dy;
  const px = point.x - projectionX;
  const py = point.y - projectionY;

  return Math.sqrt(px * px + py * py);
}

/**
 * Calculate distance from point to infinite line
 */
export function distanceToLine(
  point: Point,
  lineStart: Point,
  lineEnd: Point
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    const ex = point.x - lineStart.x;
    const ey = point.y - lineStart.y;
    return Math.sqrt(ex * ex + ey * ey);
  }

  // Distance using cross product
  const numerator = Math.abs(
    dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x
  );
  const denominator = Math.sqrt(lengthSquared);

  return numerator / denominator;
}

/**
 * Calculate distance between two points
 */
export function distanceBetweenPoints(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Check if point is within distance of another point
 */
export function isPointNear(p1: Point, p2: Point, threshold: number): boolean {
  return distanceBetweenPoints(p1, p2) <= threshold;
}

/**
 * Extend line to viewport boundaries
 */
export function extendLineToViewport(
  start: Point,
  end: Point,
  viewportWidth: number,
  viewportHeight: number,
  extendLeft: boolean,
  extendRight: boolean
): { start: Point; end: Point } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  let newStart = { ...start };
  let newEnd = { ...end };

  if (dx === 0) {
    // Vertical line
    if (extendLeft) newStart = { x: start.x, y: 0 };
    if (extendRight) newEnd = { x: end.x, y: viewportHeight };
    return { start: newStart, end: newEnd };
  }

  const slope = dy / dx;
  const intercept = start.y - slope * start.x;

  if (extendLeft) {
    // Extend towards x = 0 or viewport boundaries
    const yAtX0 = intercept;
    if (yAtX0 >= 0 && yAtX0 <= viewportHeight) {
      newStart = { x: 0, y: yAtX0 };
    } else if (yAtX0 < 0) {
      newStart = { x: -intercept / slope, y: 0 };
    } else {
      newStart = { x: (viewportHeight - intercept) / slope, y: viewportHeight };
    }
  }

  if (extendRight) {
    // Extend towards x = viewportWidth or viewport boundaries
    const yAtXMax = slope * viewportWidth + intercept;
    if (yAtXMax >= 0 && yAtXMax <= viewportHeight) {
      newEnd = { x: viewportWidth, y: yAtXMax };
    } else if (yAtXMax < 0) {
      newEnd = { x: -intercept / slope, y: 0 };
    } else {
      newEnd = { x: (viewportHeight - intercept) / slope, y: viewportHeight };
    }
  }

  return { start: newStart, end: newEnd };
}

/**
 * Get angle of line in radians
 */
export function getLineAngle(start: Point, end: Point): number {
  return Math.atan2(end.y - start.y, end.x - start.x);
}

/**
 * Get angle of line in degrees
 */
export function getLineAngleDegrees(start: Point, end: Point): number {
  return getLineAngle(start, end) * (180 / Math.PI);
}

/**
 * Rotate point around center
 */
export function rotatePoint(point: Point, center: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

/**
 * Calculate midpoint between two points
 */
export function midpoint(p1: Point, p2: Point): Point {
  return {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2,
  };
}

/**
 * Linear interpolation between two points
 */
export function lerp(p1: Point, p2: Point, t: number): Point {
  return {
    x: p1.x + (p2.x - p1.x) * t,
    y: p1.y + (p2.y - p1.y) * t,
  };
}
