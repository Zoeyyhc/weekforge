import { CalendarInfo } from "@/lib/api";

export function CalendarPicker({
  calendars,
  selectedIds,
  onToggle,
}: {
  calendars: CalendarInfo[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2" data-testid="calendar-picker">
      <legend className="text-xs font-semibold uppercase tracking-wide text-muted">
        Import from
      </legend>
      {calendars.map((c) => (
        <label key={c.id} className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={selectedIds.includes(c.id)}
            onChange={() => onToggle(c.id)}
          />
          {c.summary ?? c.id}
          {c.primary && <span className="text-xs text-muted">(primary)</span>}
        </label>
      ))}
    </fieldset>
  );
}
