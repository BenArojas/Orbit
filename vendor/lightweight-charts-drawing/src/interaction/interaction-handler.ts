import type { Anchor, Point, MouseEventData, PixelToChartFn, SnapConfig } from '../core/types';

/**
 * Interaction states for the FSM
 */
export type InteractionState = 'idle' | 'placing' | 'editing' | 'complete';

/**
 * Configuration for interaction handler
 */
export interface InteractionConfig {
  requiredAnchors: number;
  pixelToChart: PixelToChartFn;
  snapConfig?: SnapConfig;
  onAnchorAdded?: (anchor: Anchor, index: number) => void;
  onAnchorUpdated?: (anchor: Anchor, index: number) => void;
  onPreviewMove?: (previewAnchor: Anchor) => void;
  onComplete?: () => void;
  onCancel?: () => void;
}

/**
 * Interface for interaction handlers
 */
export interface IInteractionHandler {
  getState(): InteractionState;
  getAnchors(): Anchor[];
  getPreviewAnchor(): Anchor | null;

  onMouseDown(data: MouseEventData): void;
  onMouseMove(data: MouseEventData): void;
  onMouseUp(data: MouseEventData): void;
  onKeyDown(key: string): void;

  isComplete(): boolean;
  reset(): void;
}

/**
 * Base interaction handler implementing FSM for drawing placement.
 * Handles the state machine for placing anchors and completing drawings.
 */
export class InteractionHandler implements IInteractionHandler {
  protected _state: InteractionState = 'idle';
  protected _anchors: Anchor[] = [];
  protected _previewAnchor: Anchor | null = null;
  protected _editingAnchorIndex: number | null = null;
  protected _config: InteractionConfig;

  constructor(config: InteractionConfig) {
    this._config = config;
  }

  getState(): InteractionState {
    return this._state;
  }

  getAnchors(): Anchor[] {
    return [...this._anchors];
  }

  getPreviewAnchor(): Anchor | null {
    return this._previewAnchor;
  }

  onMouseDown(data: MouseEventData): void {
    const anchor = this.pointToAnchor(data.point);
    if (!anchor) return;

    switch (this._state) {
      case 'idle':
        // Start placing first anchor
        this._anchors = [anchor];
        this._state = 'placing';
        this.notifyAnchorAdded(anchor, 0);
        break;

      case 'placing':
        // Add next anchor
        if (this._anchors.length < this._config.requiredAnchors) {
          this._anchors.push(anchor);
          this.notifyAnchorAdded(anchor, this._anchors.length - 1);

          if (this._anchors.length >= this._config.requiredAnchors) {
            this._state = 'complete';
            this._previewAnchor = null;
            this.notifyComplete();
          }
        }
        break;

      case 'editing':
        // Already handled by mouse up
        break;
    }
  }

  onMouseMove(data: MouseEventData): void {
    const anchor = this.pointToAnchor(data.point);
    if (!anchor) return;

    switch (this._state) {
      case 'placing':
        // Update preview anchor
        this._previewAnchor = anchor;
        this.notifyPreviewMove(anchor);
        break;

      case 'editing':
        // Update the anchor being edited
        if (this._editingAnchorIndex !== null) {
          this._anchors[this._editingAnchorIndex] = anchor;
          this.notifyAnchorUpdated(anchor, this._editingAnchorIndex);
        }
        break;
    }
  }

  onMouseUp(_data: MouseEventData): void {
    if (this._state === 'editing') {
      this._editingAnchorIndex = null;
      this._state = 'complete';
    }
  }

  onKeyDown(key: string): void {
    if (key === 'Escape') {
      this.cancel();
    }
  }

  isComplete(): boolean {
    return this._state === 'complete';
  }

  reset(): void {
    this._state = 'idle';
    this._anchors = [];
    this._previewAnchor = null;
    this._editingAnchorIndex = null;
  }

  /**
   * Start editing a specific anchor
   */
  startEditingAnchor(index: number): void {
    if (index >= 0 && index < this._anchors.length) {
      this._state = 'editing';
      this._editingAnchorIndex = index;
    }
  }

  /**
   * Set anchors externally (for loading from saved data)
   */
  setAnchors(anchors: Anchor[]): void {
    this._anchors = [...anchors];
    if (anchors.length >= this._config.requiredAnchors) {
      this._state = 'complete';
    }
  }

  protected pointToAnchor(point: Point): Anchor | null {
    let anchor = this._config.pixelToChart(point);

    if (anchor && this._config.snapConfig) {
      anchor = this.applySnap(anchor, point);
    }

    return anchor;
  }

  protected applySnap(anchor: Anchor, _point: Point): Anchor {
    // Snap logic would be implemented here
    // For now, return anchor as-is
    return anchor;
  }

  protected cancel(): void {
    this.reset();
    this._config.onCancel?.();
  }

  protected notifyAnchorAdded(anchor: Anchor, index: number): void {
    this._config.onAnchorAdded?.(anchor, index);
  }

  protected notifyAnchorUpdated(anchor: Anchor, index: number): void {
    this._config.onAnchorUpdated?.(anchor, index);
  }

  protected notifyPreviewMove(anchor: Anchor): void {
    this._config.onPreviewMove?.(anchor);
  }

  protected notifyComplete(): void {
    this._config.onComplete?.();
  }
}

/**
 * Two-point interaction handler for line-based drawings
 */
export class TwoPointInteractionHandler extends InteractionHandler {
  constructor(config: Omit<InteractionConfig, 'requiredAnchors'>) {
    super({ ...config, requiredAnchors: 2 });
  }
}

/**
 * Three-point interaction handler for channel/pitchfork drawings
 */
export class ThreePointInteractionHandler extends InteractionHandler {
  constructor(config: Omit<InteractionConfig, 'requiredAnchors'>) {
    super({ ...config, requiredAnchors: 3 });
  }
}

/**
 * Single-point interaction handler for vertical/horizontal lines
 */
export class SinglePointInteractionHandler extends InteractionHandler {
  constructor(config: Omit<InteractionConfig, 'requiredAnchors'>) {
    super({ ...config, requiredAnchors: 1 });
  }
}
