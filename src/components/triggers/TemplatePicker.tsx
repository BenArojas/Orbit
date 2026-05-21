import type { TriggerCondition } from "@/lib/api";

interface Props {
  onPick: (t: {
    id: number;
    name: string;
    default_timeframe: string;
    conditions: TriggerCondition[];
  }) => void;
}

// Real implementation in Task 6.
export function TemplatePicker(_props: Props) {
  return null;
}
