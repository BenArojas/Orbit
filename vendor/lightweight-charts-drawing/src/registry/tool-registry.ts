import type { DrawingToolDefinition, DrawingCategory, Anchor, DrawingStyle, DrawingOptions, IDrawing } from '../core/types';

// Import all drawing tools
import { TrendLine } from '../tools/lines/trend-line';
import { HorizontalLine } from '../tools/lines/horizontal-line';
import { VerticalLine } from '../tools/lines/vertical-line';
import { Ray } from '../tools/lines/ray';
import { Arrow } from '../tools/lines/arrow';
import { ExtendedLine } from '../tools/lines/extended-line';
import { CrossLine } from '../tools/lines/cross-line';
import { InfoLine } from '../tools/lines/info-line';
import { TrendAngle } from '../tools/lines/trend-angle';
import { HorizontalRay } from '../tools/lines/horizontal-ray';

import { Rectangle } from '../tools/shapes/rectangle';
import { Circle } from '../tools/shapes/circle';
import { Triangle } from '../tools/shapes/triangle';
import { PriceRange } from '../tools/shapes/price-range';

import { ParallelChannel } from '../tools/channels/parallel-channel';
import { RegressionTrend } from '../tools/channels/regression-trend';
import { FlatTopBottom } from '../tools/channels/flat-top-bottom';
import { DisjointChannel } from '../tools/channels/disjoint-channel';
import { FibRetracement } from '../tools/channels/fib-retracement';

import { FibExtension } from '../tools/fibonacci/fib-extension';
import { FibChannel } from '../tools/fibonacci/fib-channel';
import { FibTimeZone } from '../tools/fibonacci/fib-time-zone';
import { FibSpeedFan } from '../tools/fibonacci/fib-speed-fan';
import { FibTimeExtension } from '../tools/fibonacci/fib-time-extension';
import { FibCircles } from '../tools/fibonacci/fib-circles';
import { FibSpiral } from '../tools/fibonacci/fib-spiral';
import { FibArcs } from '../tools/fibonacci/fib-arcs';
import { FibWedge } from '../tools/fibonacci/fib-wedge';
import { Pitchfan } from '../tools/fibonacci/pitchfan';

import { AndrewsPitchfork } from '../tools/pitchforks/andrews-pitchfork';
import { SchiffPitchfork } from '../tools/pitchforks/schiff-pitchfork';
import { ModifiedSchiffPitchfork } from '../tools/pitchforks/modified-schiff-pitchfork';
import { InsidePitchfork } from '../tools/pitchforks/inside-pitchfork';

import { GannBox } from '../tools/gann/gann-box';
import { GannFan } from '../tools/gann/gann-fan';
import { GannSquareFixed } from '../tools/gann/gann-square-fixed';
import { GannSquare } from '../tools/gann/gann-square';

import { LongPosition } from '../tools/forecasting/long-position';
import { ShortPosition } from '../tools/forecasting/short-position';
import { DateRange } from '../tools/forecasting/date-range';
import { DatePriceRange } from '../tools/forecasting/date-price-range';
import { Projection } from '../tools/forecasting/projection';

import { TextAnnotation } from '../tools/annotations/text-annotation';
import { Callout } from '../tools/annotations/callout';
import { Brush } from '../tools/annotations/brush';
import { Highlighter } from '../tools/annotations/highlighter';
import { ArrowMarker } from '../tools/annotations/arrow-marker';
import { ArrowMarkUp } from '../tools/annotations/arrow-mark-up';
import { ArrowMarkDown } from '../tools/annotations/arrow-mark-down';
import { AnchoredText } from '../tools/annotations/anchored-text';
import { Note } from '../tools/annotations/note';
import { PriceNote } from '../tools/annotations/price-note';
import { PriceLabel } from '../tools/annotations/price-label';
import { FlagMark } from '../tools/annotations/flag-mark';
import { Pin } from '../tools/annotations/pin';
import { Comment } from '../tools/annotations/comment';
import { Signpost } from '../tools/annotations/signpost';
import { Table } from '../tools/annotations/table';

import { Forecast } from '../tools/forecasting/forecast';
import { BarsPattern } from '../tools/forecasting/bars-pattern';

import { Ellipse } from '../tools/shapes/ellipse';
import { Arc } from '../tools/shapes/arc';
import { RotatedRectangle } from '../tools/shapes/rotated-rectangle';
import { Path } from '../tools/shapes/path';
import { Polyline } from '../tools/shapes/polyline';
import { Curve } from '../tools/shapes/curve';
import { DoubleCurve } from '../tools/shapes/double-curve';

/**
 * Tool definition with factory function
 */
interface ToolRegistryEntry extends DrawingToolDefinition {
  factory: (id: string, anchors?: Anchor[], style?: Partial<DrawingStyle>, options?: Partial<DrawingOptions>) => IDrawing;
}

/**
 * All registered drawing tools
 */
const TOOL_DEFINITIONS: ToolRegistryEntry[] = [
  // Line Tools
  {
    type: 'trend-line',
    name: 'Trend Line',
    category: 'line',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new TrendLine(id, anchors, style, options),
  },
  {
    type: 'horizontal-line',
    name: 'Horizontal Line',
    category: 'line',
    requiredAnchors: 1,
    factory: (id, anchors, style, options) => new HorizontalLine(id, anchors, style, options),
  },
  {
    type: 'vertical-line',
    name: 'Vertical Line',
    category: 'line',
    requiredAnchors: 1,
    factory: (id, anchors, style, options) => new VerticalLine(id, anchors, style, options),
  },
  {
    type: 'ray',
    name: 'Ray',
    category: 'line',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new Ray(id, anchors, style, options),
  },
  {
    type: 'arrow',
    name: 'Arrow',
    category: 'line',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new Arrow(id, anchors, style, options),
  },
  {
    type: 'extended-line',
    name: 'Extended Line',
    category: 'line',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new ExtendedLine(id, anchors, style, options),
  },
  {
    type: 'cross-line',
    name: 'Cross Line',
    category: 'line',
    requiredAnchors: 1,
    factory: (id, anchors, style, options) => new CrossLine(id, anchors, style, options),
  },
  {
    type: 'info-line',
    name: 'Info Line',
    category: 'line',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new InfoLine(id, anchors, style, options),
  },
  {
    type: 'trend-angle',
    name: 'Trend Angle',
    category: 'line',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new TrendAngle(id, anchors, style, options),
  },
  {
    type: 'horizontal-ray',
    name: 'Horizontal Ray',
    category: 'line',
    requiredAnchors: 1,
    factory: (id, anchors, style, options) => new HorizontalRay(id, anchors, style, options),
  },

  // Shape Tools
  {
    type: 'rectangle',
    name: 'Rectangle',
    category: 'shape',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new Rectangle(id, anchors, style, options),
  },
  {
    type: 'circle',
    name: 'Circle',
    category: 'shape',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new Circle(id, anchors, style, options),
  },
  {
    type: 'triangle',
    name: 'Triangle',
    category: 'shape',
    requiredAnchors: 3,
    factory: (id, anchors, style, options) => new Triangle(id, anchors, style, options),
  },
  {
    type: 'price-range',
    name: 'Price Range',
    category: 'shape',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new PriceRange(id, anchors, style, options),
  },

  // Channel Tools
  {
    type: 'parallel-channel',
    name: 'Parallel Channel',
    category: 'channel',
    requiredAnchors: 3,
    factory: (id, anchors, style, options) => new ParallelChannel(id, anchors, style, options),
  },
  {
    type: 'regression-trend',
    name: 'Regression Trend',
    category: 'channel',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new RegressionTrend(id, anchors, style, options),
  },
  {
    type: 'flat-top-bottom',
    name: 'Flat Top/Bottom',
    category: 'channel',
    requiredAnchors: 3,
    factory: (id, anchors, style, options) => new FlatTopBottom(id, anchors, style, options),
  },
  {
    type: 'disjoint-channel',
    name: 'Disjoint Channel',
    category: 'channel',
    requiredAnchors: 4,
    factory: (id, anchors, style, options) => new DisjointChannel(id, anchors, style, options),
  },
  {
    type: 'fib-retracement',
    name: 'Fibonacci Retracement',
    category: 'fibonacci',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new FibRetracement(id, anchors, style, options),
  },

  // Fibonacci Tools
  {
    type: 'fib-extension',
    name: 'Fibonacci Extension',
    category: 'fibonacci',
    requiredAnchors: 3,
    factory: (id, anchors, style, options) => new FibExtension(id, anchors, style, options),
  },
  {
    type: 'fib-channel',
    name: 'Fibonacci Channel',
    category: 'fibonacci',
    requiredAnchors: 3,
    factory: (id, anchors, style, options) => new FibChannel(id, anchors, style, options),
  },
  {
    type: 'fib-time-zone',
    name: 'Fibonacci Time Zone',
    category: 'fibonacci',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new FibTimeZone(id, anchors, style, options),
  },
  {
    type: 'fib-speed-fan',
    name: 'Fibonacci Speed Fan',
    category: 'fibonacci',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new FibSpeedFan(id, anchors, style, options),
  },
  {
    type: 'fib-time-extension',
    name: 'Trend-Based Fib Time',
    category: 'fibonacci',
    requiredAnchors: 3,
    factory: (id, anchors, style, options) => new FibTimeExtension(id, anchors, style, options),
  },
  {
    type: 'fib-circles',
    name: 'Fibonacci Circles',
    category: 'fibonacci',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new FibCircles(id, anchors, style, options),
  },
  {
    type: 'fib-spiral',
    name: 'Fibonacci Spiral',
    category: 'fibonacci',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new FibSpiral(id, anchors, style, options),
  },
  {
    type: 'fib-arcs',
    name: 'Fibonacci Arcs',
    category: 'fibonacci',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new FibArcs(id, anchors, style, options),
  },
  {
    type: 'fib-wedge',
    name: 'Fibonacci Wedge',
    category: 'fibonacci',
    requiredAnchors: 3,
    factory: (id, anchors, style, options) => new FibWedge(id, anchors, style, options),
  },
  {
    type: 'pitchfan',
    name: 'Pitchfan',
    category: 'fibonacci',
    requiredAnchors: 3,
    factory: (id, anchors, style, options) => new Pitchfan(id, anchors, style, options),
  },

  // Pitchfork Tools
  {
    type: 'andrews-pitchfork',
    name: "Andrews' Pitchfork",
    category: 'pitchfork',
    requiredAnchors: 3,
    factory: (id, anchors, style, options) => new AndrewsPitchfork(id, anchors, style, options),
  },
  {
    type: 'schiff-pitchfork',
    name: 'Schiff Pitchfork',
    category: 'pitchfork',
    requiredAnchors: 3,
    factory: (id, anchors, style, options) => new SchiffPitchfork(id, anchors, style, options),
  },
  {
    type: 'modified-schiff-pitchfork',
    name: 'Modified Schiff Pitchfork',
    category: 'pitchfork',
    requiredAnchors: 3,
    factory: (id, anchors, style, options) => new ModifiedSchiffPitchfork(id, anchors, style, options),
  },
  {
    type: 'inside-pitchfork',
    name: 'Inside Pitchfork',
    category: 'pitchfork',
    requiredAnchors: 3,
    factory: (id, anchors, style, options) => new InsidePitchfork(id, anchors, style, options),
  },

  // Gann Tools
  {
    type: 'gann-box',
    name: 'Gann Box',
    category: 'gann',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new GannBox(id, anchors, style, options),
  },
  {
    type: 'gann-fan',
    name: 'Gann Fan',
    category: 'gann',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new GannFan(id, anchors, style, options),
  },
  {
    type: 'gann-square-fixed',
    name: 'Gann Square Fixed',
    category: 'gann',
    requiredAnchors: 1,
    factory: (id, anchors, style, options) => new GannSquareFixed(id, anchors, style, options),
  },
  {
    type: 'gann-square',
    name: 'Gann Square',
    category: 'gann',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new GannSquare(id, anchors, style, options),
  },

  // Forecasting Tools
  {
    type: 'long-position',
    name: 'Long Position',
    category: 'forecasting',
    requiredAnchors: 3,
    factory: (id, anchors, style, options) => new LongPosition(id, anchors, style, options),
  },
  {
    type: 'short-position',
    name: 'Short Position',
    category: 'forecasting',
    requiredAnchors: 3,
    factory: (id, anchors, style, options) => new ShortPosition(id, anchors, style, options),
  },
  {
    type: 'date-range',
    name: 'Date Range',
    category: 'measurement',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new DateRange(id, anchors, style, options),
  },
  {
    type: 'date-price-range',
    name: 'Date and Price Range',
    category: 'measurement',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new DatePriceRange(id, anchors, style, options),
  },
  {
    type: 'projection',
    name: 'Projection',
    category: 'forecasting',
    requiredAnchors: 3,
    factory: (id, anchors, style, options) => new Projection(id, anchors, style, options),
  },

  // Annotation Tools
  {
    type: 'text-annotation',
    name: 'Text',
    category: 'annotation',
    requiredAnchors: 1,
    factory: (id, anchors, style, options) => new TextAnnotation(id, anchors, style, options),
  },
  {
    type: 'callout',
    name: 'Callout',
    category: 'annotation',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new Callout(id, anchors, style, options),
  },
  {
    type: 'brush',
    name: 'Brush',
    category: 'annotation',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new Brush(id, anchors, style, options),
  },
  {
    type: 'highlighter',
    name: 'Highlighter',
    category: 'annotation',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new Highlighter(id, anchors, style, options),
  },
  {
    type: 'arrow-marker',
    name: 'Arrow Marker',
    category: 'annotation',
    requiredAnchors: 1,
    factory: (id, anchors, style, options) => new ArrowMarker(id, anchors, style, options),
  },
  {
    type: 'arrow-mark-up',
    name: 'Arrow Mark Up',
    category: 'annotation',
    requiredAnchors: 1,
    factory: (id, anchors, style, options) => new ArrowMarkUp(id, anchors, style, options),
  },
  {
    type: 'arrow-mark-down',
    name: 'Arrow Mark Down',
    category: 'annotation',
    requiredAnchors: 1,
    factory: (id, anchors, style, options) => new ArrowMarkDown(id, anchors, style, options),
  },

  // Additional Shape Tools
  {
    type: 'ellipse',
    name: 'Ellipse',
    category: 'shape',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new Ellipse(id, anchors, style, options),
  },
  {
    type: 'arc',
    name: 'Arc',
    category: 'shape',
    requiredAnchors: 3,
    factory: (id, anchors, style, options) => new Arc(id, anchors, style, options),
  },
  {
    type: 'rotated-rectangle',
    name: 'Rotated Rectangle',
    category: 'shape',
    requiredAnchors: 3,
    factory: (id, anchors, style, options) => new RotatedRectangle(id, anchors, style, options),
  },
  {
    type: 'path',
    name: 'Path',
    category: 'shape',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new Path(id, anchors, style, options),
  },
  {
    type: 'polyline',
    name: 'Polyline',
    category: 'shape',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new Polyline(id, anchors, style, options),
  },
  {
    type: 'curve',
    name: 'Curve',
    category: 'shape',
    requiredAnchors: 4,
    factory: (id, anchors, style, options) => new Curve(id, anchors, style, options),
  },
  {
    type: 'double-curve',
    name: 'Double Curve',
    category: 'shape',
    requiredAnchors: 3,
    factory: (id, anchors, style, options) => new DoubleCurve(id, anchors, style, options),
  },

  // Additional Annotation Tools
  {
    type: 'anchored-text',
    name: 'Anchored Text',
    category: 'annotation',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new AnchoredText(id, anchors, style, options),
  },
  {
    type: 'note',
    name: 'Note',
    category: 'annotation',
    requiredAnchors: 1,
    factory: (id, anchors, style, options) => new Note(id, anchors, style, options),
  },
  {
    type: 'price-note',
    name: 'Price Note',
    category: 'annotation',
    requiredAnchors: 1,
    factory: (id, anchors, style, options) => new PriceNote(id, anchors, style, options),
  },
  {
    type: 'price-label',
    name: 'Price Label',
    category: 'annotation',
    requiredAnchors: 1,
    factory: (id, anchors, style, options) => new PriceLabel(id, anchors, style, options),
  },
  {
    type: 'flag-mark',
    name: 'Flag Mark',
    category: 'annotation',
    requiredAnchors: 1,
    factory: (id, anchors, style, options) => new FlagMark(id, anchors, style, options),
  },
  {
    type: 'pin',
    name: 'Pin',
    category: 'annotation',
    requiredAnchors: 1,
    factory: (id, anchors, style, options) => new Pin(id, anchors, style, options),
  },
  {
    type: 'comment',
    name: 'Comment',
    category: 'annotation',
    requiredAnchors: 1,
    factory: (id, anchors, style, options) => new Comment(id, anchors, style, options),
  },
  {
    type: 'signpost',
    name: 'Signpost',
    category: 'annotation',
    requiredAnchors: 1,
    factory: (id, anchors, style, options) => new Signpost(id, anchors, style, options),
  },
  {
    type: 'table',
    name: 'Table',
    category: 'annotation',
    requiredAnchors: 1,
    factory: (id, anchors, style, options) => new Table(id, anchors, style, options),
  },
  {
    type: 'forecast',
    name: 'Forecast',
    category: 'forecasting',
    requiredAnchors: 2,
    factory: (id, anchors, style, options) => new Forecast(id, anchors, style, options),
  },
  {
    type: 'bars-pattern',
    name: 'Bars Pattern',
    category: 'forecasting',
    requiredAnchors: 3,
    factory: (id, anchors, style, options) => new BarsPattern(id, anchors, style, options),
  },
];

/**
 * Tool Registry - Central registry for all drawing tools.
 */
export class ToolRegistry {
  private static _instance: ToolRegistry;
  private _tools: Map<string, ToolRegistryEntry> = new Map();

  private constructor() {
    // Register default tools
    for (const tool of TOOL_DEFINITIONS) {
      this._tools.set(tool.type, tool);
    }
  }

  static getInstance(): ToolRegistry {
    if (!ToolRegistry._instance) {
      ToolRegistry._instance = new ToolRegistry();
    }
    return ToolRegistry._instance;
  }

  /**
   * Register a custom tool
   */
  register(entry: ToolRegistryEntry): void {
    this._tools.set(entry.type, entry);
  }

  /**
   * Get tool definition by type
   */
  get(type: string): ToolRegistryEntry | undefined {
    return this._tools.get(type);
  }

  /**
   * Get all tool definitions
   */
  getAll(): ToolRegistryEntry[] {
    return Array.from(this._tools.values());
  }

  /**
   * Get tools by category
   */
  getByCategory(category: DrawingCategory): ToolRegistryEntry[] {
    return Array.from(this._tools.values()).filter((t) => t.category === category);
  }

  /**
   * Get all categories
   */
  getCategories(): DrawingCategory[] {
    const categories = new Set<DrawingCategory>();
    for (const tool of this._tools.values()) {
      categories.add(tool.category);
    }
    return Array.from(categories);
  }

  /**
   * Create a drawing instance
   */
  createDrawing(
    type: string,
    id: string,
    anchors?: Anchor[],
    style?: Partial<DrawingStyle>,
    options?: Partial<DrawingOptions>
  ): IDrawing | null {
    const entry = this._tools.get(type);
    if (!entry) return null;
    return entry.factory(id, anchors, style, options);
  }

  /**
   * Check if a tool type is registered
   */
  has(type: string): boolean {
    return this._tools.has(type);
  }
}

// Export singleton getter
export function getToolRegistry(): ToolRegistry {
  return ToolRegistry.getInstance();
}

// Export tool definitions for reference
export { TOOL_DEFINITIONS };
