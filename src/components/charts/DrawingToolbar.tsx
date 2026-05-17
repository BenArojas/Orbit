/**
 * DrawingToolbar — vertical left rail for the Analysis chart.
 *
 * Layout (top → bottom):
 *   - 6 core drawing-tool buttons (one per CORE_TOOLS entry)
 *   - Divider + "Projection" label
 *   - 4 projection-tool buttons (one per PROJECTION_TOOLS entry)
 *   - Divider
 *   - "Hide all" toggle (Eye / EyeOff)
 *   - "Delete selected" button (disabled when nothing is selected)
 *
 * Clicking an active button deactivates it (pointer mode). Clicking
 * a different button switches tools. The active button glows with
 * var(--clr-cyan). Tooltips appear to the right of each button.
 *
 * Plan: docs/drawing-tools-plan.md, Branches 3–4.
 */

import { Eye, EyeOff, MousePointerClick, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDrawingsStore } from "@/store/drawings";
import { useDeleteDrawing } from "@/hooks/useDrawings";
import { CORE_TOOLS, PROJECTION_TOOLS } from "./drawingsRegistry";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ── Props ─────────────────────────────────────────────────────

interface DrawingToolbarProps {
  conid: number | null;
}

// ── Toolbar button ─────────────────────────────────────────────

interface ToolButtonProps {
  label: string;
  shortcut?: string;
  isActive?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}

function ToolButton({
  label,
  shortcut,
  isActive,
  disabled,
  onClick,
  children,
  className,
}: ToolButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded transition-all",
              isActive
                ? "border border-[var(--clr-cyan)] bg-[rgba(0,212,255,0.12)] text-[var(--clr-cyan)] shadow-[0_0_8px_var(--glow-cyan)]"
                : "text-[var(--text-3)] hover:bg-[var(--bg-2)] hover:text-[var(--text-1)]",
              disabled && "cursor-not-allowed opacity-30",
              className,
            )}
          >
            {children}
          </button>
        }
      />
      <TooltipContent side="right" sideOffset={6}>
        {label}
        {shortcut && (
          <span className="ml-1.5 font-mono text-[10px] opacity-60">[{shortcut}]</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// ── Component ─────────────────────────────────────────────────

export default function DrawingToolbar({ conid }: DrawingToolbarProps) {
  const activeTool        = useDrawingsStore((s) => s.activeTool);
  const selectedDrawingId = useDrawingsStore((s) => s.selectedDrawingId);
  const drawingsHidden    = useDrawingsStore((s) => s.drawingsHidden);
  const setActiveTool        = useDrawingsStore((s) => s.setActiveTool);
  const setSelectedDrawingId = useDrawingsStore((s) => s.setSelectedDrawingId);
  const toggleDrawingsHidden = useDrawingsStore((s) => s.toggleDrawingsHidden);

  const deleteDrawing = useDeleteDrawing(conid ?? 0);

  const handleToolClick = (toolId: NonNullable<typeof activeTool>) => {
    // Second click on the same tool exits draw mode (toggle).
    setActiveTool(activeTool === toolId ? null : toolId);
  };

  const handleDeleteSelected = () => {
    if (selectedDrawingId == null) return;
    deleteDrawing.mutate(selectedDrawingId);
    setSelectedDrawingId(null);
  };

  return (
    <TooltipProvider delay={300}>
      <div
        className={cn(
          "flex h-full w-8 shrink-0 flex-col items-center border-r bg-[var(--bg-1)] transition-all duration-200",
          activeTool
            ? "border-[var(--clr-cyan)]/40 shadow-[inset_-2px_0_10px_rgba(0,212,255,0.08)]"
            : "border-border",
        )}
        data-testid="drawing-toolbar"
      >
        {/* ── Drawing tools — vertically centered in the available space ── */}
        <div className="flex flex-1 flex-col items-center justify-center gap-1 py-2">
          {/* Mode indicator dot — glows cyan when a tool is active */}
          {activeTool ? (
            <div className="mb-1 flex h-3 w-3 items-center justify-center">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--clr-cyan)] shadow-[0_0_6px_var(--glow-cyan)]" />
            </div>
          ) : (
            <div className="mb-1 flex h-3 w-3 items-center justify-center">
              <MousePointerClick size={10} className="text-[var(--text-3)]" />
            </div>
          )}

          {/* ── Core tools ── */}
          {CORE_TOOLS.map((tool) => (
            <ToolButton
              key={tool.id}
              label={tool.label}
              shortcut={tool.shortcut}
              isActive={activeTool === tool.id}
              onClick={() => handleToolClick(tool.id)}
            >
              <tool.Icon
                size={14}
                className={tool.iconClass}
                data-testid={`tool-icon-${tool.id}`}
              />
            </ToolButton>
          ))}

          {/* ── Projection tools section ── */}
          <div className="my-0.5 h-px w-6 bg-[var(--border)]" />
          <span className="select-none font-mono text-[7px] uppercase tracking-widest text-[var(--text-3)]">
            Proj
          </span>
          {PROJECTION_TOOLS.map((tool) => (
            <ToolButton
              key={tool.id}
              label={tool.label}
              shortcut={tool.shortcut}
              isActive={activeTool === tool.id}
              onClick={() => handleToolClick(tool.id)}
            >
              <tool.Icon
                size={14}
                data-testid={`tool-icon-${tool.id}`}
              />
            </ToolButton>
          ))}
        </div>

        {/* ── Utility buttons pinned to bottom ── */}
        <div className="flex flex-col items-center gap-1 border-t border-border pb-2 pt-2">
          {/* ── Hide / show all drawings ── */}
          <ToolButton
            label={drawingsHidden ? "Show all drawings" : "Hide all drawings"}
            isActive={drawingsHidden}
            onClick={toggleDrawingsHidden}
          >
            {drawingsHidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </ToolButton>

          {/* ── Delete selected ── */}
          <ToolButton
            label="Delete selected drawing"
            shortcut="Del"
            disabled={selectedDrawingId == null}
            onClick={handleDeleteSelected}
            className={selectedDrawingId != null ? "hover:text-[var(--clr-red)]" : ""}
          >
            <Trash2 size={14} />
          </ToolButton>
        </div>
      </div>
    </TooltipProvider>
  );
}
