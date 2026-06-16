"use client";

import { useState } from "react";
import { fromISODate, toISODate, isWeekSelectable, monthWeeks } from "@/lib/weekWindow";

const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function shiftMonth(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function WeekPicker({
  value,
  onChange,
  workdayEndHour,
  now = new Date(),
}: {
  value: string;
  onChange: (mondayISO: string) => void;
  workdayEndHour: number;
  now?: Date;
}) {
  const selectedMonth = startOfMonth(fromISODate(value));
  const [viewState, setViewState] = useState(() => ({
    month: selectedMonth,
    syncedValue: value,
  }));

  const nextViewState =
    viewState.syncedValue === value
      ? viewState
      : {
          month: isSameMonth(viewState.month, selectedMonth) ? viewState.month : selectedMonth,
          syncedValue: value,
        };

  if (nextViewState !== viewState) {
    setViewState(nextViewState);
  }

  const viewMonth = nextViewState.month;

  const weeks = monthWeeks(viewMonth);

  return (
    <section className="rounded-xl border border-[#272430] bg-gradient-to-b from-[#15171f] to-[#101219] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex items-center justify-between border-b border-[#272430] px-4 py-3">
        <div>
          <p className="font-display text-[1rem] leading-none tracking-tight text-foreground">
            {MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
          </p>
          <p className="mt-1 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted">
            Week picker
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() =>
              setViewState((state) => ({ ...state, month: shiftMonth(state.month, -1) }))
            }
            className="rounded-md border border-[#272430] bg-[#0c0d12] px-2.5 py-1.5 font-mono text-xs text-muted transition-colors hover:border-[#34303c] hover:text-foreground"
          >
            ←
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() =>
              setViewState((state) => ({ ...state, month: shiftMonth(state.month, 1) }))
            }
            className="rounded-md border border-[#272430] bg-[#0c0d12] px-2.5 py-1.5 font-mono text-xs text-muted transition-colors hover:border-[#34303c] hover:text-foreground"
          >
            →
          </button>
        </div>
      </div>

      <div className="border-b border-[#272430] px-4 py-2">
        <div className="grid grid-cols-7 gap-1">
          {DOW.map((day) => (
            <div key={day} className="text-center font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
              {day}
            </div>
          ))}
        </div>
      </div>

      <div className="p-2">
        <div className="flex flex-col gap-1">
          {weeks.map((monday) => {
            const iso = toISODate(monday);
            const isSelected = iso === value;
            const selectable = isWeekSelectable(monday, now, workdayEndHour);
            const days = Array.from({ length: 7 }, (_, index) => {
              const date = new Date(monday);
              date.setDate(date.getDate() + index);
              const visible = date.getMonth() === viewMonth.getMonth();
              return { date, visible };
            });

            return (
              <button
                key={iso}
                type="button"
                data-testid={`week-row-${iso}`}
                aria-pressed={isSelected}
                disabled={!selectable}
                onClick={() => {
                  if (!selectable) {
                    return;
                  }

                  setViewState((state) => ({ ...state, syncedValue: iso }));
                  onChange(iso);
                }}
                className={`grid grid-cols-7 gap-1 rounded-lg border px-2 py-2 text-left transition-colors ${
                  isSelected
                    ? "border-amber/50 bg-amber/10"
                    : "border-transparent bg-transparent hover:border-[#34303c] hover:bg-white/[0.025]"
                } ${
                  selectable ? "text-foreground" : "cursor-not-allowed opacity-40"
                }`}
              >
                {days.map(({ date, visible }) => (
                  <span
                    key={date.toISOString()}
                    className={`flex h-8 items-center justify-center rounded-md font-mono text-sm ${
                      visible ? "text-foreground" : "text-muted/50"
                    }`}
                  >
                    {date.getDate()}
                  </span>
                ))}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
