import { TimeBlock } from "@/lib/types";

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "UTC", weekday: "short", hour: "2-digit", minute: "2-digit",
  });
}

export function ImportPreview({
  blocks,
  onRemove,
}: {
  blocks: TimeBlock[];
  onRemove: (index: number) => void;
}) {
  if (blocks.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="import-preview-empty">
        No imported commitments yet.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1" data-testid="import-preview">
      {blocks.map((b, i) => (
        <li
          key={i}
          className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-sm"
        >
          <span className="font-medium text-foreground">{b.label}</span>
          <span className="flex items-center gap-3">
            <span className="text-muted">{timeLabel(b.start)}</span>
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label={`Remove ${b.label}`}
              className="text-muted hover:text-rose-300"
            >
              ✕
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
