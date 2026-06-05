/**
 * NumericFilterInput — Number input with thousands-separator formatting.
 *
 * Used by every screener filter value field (QuickPickChip, AddFilterDropdown,
 * FilterPill edit popover) so large numbers like "10000000" render as
 * "10,000,000" without the user having to count digits.
 *
 * Why not <input type="number">?
 *   The native number input strips commas and doesn't allow display formatting.
 *   We use type="text" with inputMode="decimal" so mobile keyboards still get
 *   a numeric pad while we control the display.
 *
 * Storage model:
 *   `value` is always the raw numeric string (no commas). Parents store the
 *   raw value in their state and pass it back unchanged. Display formatting
 *   is computed on every render — there is no separate "formatted" state to
 *   keep in sync.
 *
 * Allowed input:
 *   - Digits 0-9
 *   - One leading "-" (negative numbers — required for filters like
 *     lastVsEMAChangeRatio20Below where value="-5" is valid)
 *   - One "." for decimals (e.g. "15.5" for P/E)
 *   - Empty string while user is editing
 *   Anything else is rejected at the change event so invalid characters never
 *   reach the parent.
 */

import { forwardRef } from "react";

/** Format a raw numeric string with thousands separators. Preserves trailing
 *  decimal points and minus signs so the user can type "1234." or "-" without
 *  the input bouncing. */
export function formatWithCommas(raw: string): string {
  if (raw === "" || raw === "-" || raw === "." || raw === "-.") return raw;

  const isNegative = raw.startsWith("-");
  const abs = isNegative ? raw.slice(1) : raw;
  const [intPart, decPart] = abs.split(".");
  const intWithCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const formatted = decPart !== undefined ? `${intWithCommas}.${decPart}` : intWithCommas;
  return isNegative ? `-${formatted}` : formatted;
}

/** Strip commas from a display-formatted value to recover the raw string. */
export function stripCommas(display: string): string {
  return display.replace(/,/g, "");
}

/** Validate a raw numeric string. Empty allowed (user clearing the field).
 *  Permits optional leading minus, digits, and at most one decimal point. */
export function isValidNumericInput(raw: string): boolean {
  if (raw === "") return true;
  return /^-?\d*\.?\d*$/.test(raw);
}

interface NumericFilterInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  /** Raw numeric string — no commas. */
  value: string;
  /** Called with the raw numeric string after stripping commas. */
  onChange: (rawValue: string) => void;
  /** Optional Enter handler — most filter popovers commit on Enter. */
  onEnter?: () => void;
  /** Optional Escape handler — most filter popovers close on Escape. */
  onEscape?: () => void;
}

const NumericFilterInput = forwardRef<HTMLInputElement, NumericFilterInputProps>(
  function NumericFilterInput({ value, onChange, onEnter, onEscape, onKeyDown, ...rest }, ref) {
    return (
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        value={formatWithCommas(value)}
        onChange={(e) => {
          const raw = stripCommas(e.target.value);
          if (isValidNumericInput(raw)) {
            onChange(raw);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) {
            e.preventDefault();
            onEnter();
          } else if (e.key === "Escape" && onEscape) {
            e.preventDefault();
            onEscape();
          }
          onKeyDown?.(e);
        }}
        {...rest}
      />
    );
  },
);

export default NumericFilterInput;
