import { useState, useEffect, useCallback, useMemo } from "react";
import { Shell } from "./components/Shell";

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewMode = "week" | "month";

interface ScheduleItem {
  id: string;
  time: string;       // "HH:MM"
  label: string;
  days: number[];     // 0=Sun … 6=Sat
  done: boolean[];    // per-day completion for current week
}

interface ScheduleTab {
  id: string;
  label: string;       // e.g. "Week of Jun 2" or "June 2025"
  kind: ViewMode;
  startDate: string;   // ISO date string (Monday for week, 1st for month)
  items: ScheduleItem[];
  createdAt: number;
}

interface AppData {
  tabs: ScheduleTab[];
  activeTabId: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "scheduleapp_data";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { tabs: [], activeTabId: null };
}

function saveData(d: AppData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
}

function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isoDate(d: Date) {
  return d.toISOString().split("T")[0];
}

function parseIso(s: string): Date {
  const [y, m, day] = s.split("-").map(Number);
  return new Date(y, m - 1, day);
}

function weekLabel(startIso: string): string {
  const d = parseIso(startIso);
  return `Week of ${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

function monthLabel(startIso: string): string {
  const d = parseIso(startIso);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

function todayDayIndex(): number {
  return new Date().getDay(); // 0=Sun
}

function todayIso(): string {
  return isoDate(new Date());
}

// For a week tab: which column index (0-6) is today?
function todayColForWeek(startIso: string): number | null {
  const start = parseIso(startIso); // Monday
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - start.getTime()) / 86400000);
  if (diff >= 0 && diff < 7) return diff;
  return null;
}

// For a month tab: is today in this month?
function todayInMonth(startIso: string): boolean {
  const d = parseIso(startIso);
  const today = new Date();
  return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
}

function getWeekDates(startIso: string): string[] {
  const start = parseIso(startIso);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return isoDate(d);
  });
}

function getDaysInMonth(startIso: string): { date: string; dayOfWeek: number }[] {
  const d = parseIso(startIso);
  const year = d.getFullYear();
  const month = d.getMonth();
  const count = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: count }, (_, i) => {
    const dt = new Date(year, month, i + 1);
    return { date: isoDate(dt), dayOfWeek: dt.getDay() };
  });
}

// ─── Notification helper ──────────────────────────────────────────────────────

function requestNotifPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function scheduleReminder(label: string, time: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const [h, m] = time.split(":").map(Number);
  const now = new Date();
  const target = new Date();
  target.setHours(h, m, 0, 0);
  const diff = target.getTime() - now.getTime();
  if (diff > 0 && diff < 86400000) {
    setTimeout(() => {
      new Notification("📅 Schedule Reminder", { body: label, icon: "/manifest.json" });
    }, diff);
  }
}

// ─── New Tab Modal ────────────────────────────────────────────────────────────

function NewTabModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (tab: ScheduleTab) => void;
}) {
  const [kind, setKind] = useState<ViewMode>("week");
  const [dateVal, setDateVal] = useState(isoDate(getMondayOf(new Date())));

  const handleCreate = () => {
    const start =
      kind === "week"
        ? isoDate(getMondayOf(parseIso(dateVal)))
        : isoDate(new Date(parseIso(dateVal).getFullYear(), parseIso(dateVal).getMonth(), 1));

    const label = kind === "week" ? weekLabel(start) : monthLabel(start);

    const tab: ScheduleTab = {
      id: uid(),
      label,
      kind,
      startDate: start,
      items: [],
      createdAt: Date.now(),
    };
    onAdd(tab);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-5"
        style={{ background: "var(--paper)", border: "1px solid var(--line)" }}
      >
        <h2 className="text-lg font-bold" style={{ fontFamily: "Fraunces, serif" }}>
          New Schedule Tab
        </h2>

        {/* Kind toggle */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
            Type
          </p>
          <div
            className="flex rounded-xl p-1 gap-1"
            style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
          >
            {(["week", "month"] as ViewMode[]).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all capitalize"
                style={{
                  background: kind === k ? "var(--accent)" : "transparent",
                  color: kind === k ? "#fff" : "var(--muted)",
                }}
              >
                {k === "week" ? "📅 Week" : "🗓️ Month"}
              </button>
            ))}
          </div>
        </div>

        {/* Date picker */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
            {kind === "week" ? "Any day in that week" : "Any day in that month"}
          </p>
          <input
            type="date"
            value={dateVal}
            onChange={(e) => setDateVal(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl text-sm"
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              color: "var(--ink)",
            }}
          />
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink)" }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: "var(--accent)" }}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add Item Modal ───────────────────────────────────────────────────────────

function AddItemModal({
  onClose,
  onAdd,
  tab,
}: {
  onClose: () => void;
  onAdd: (item: ScheduleItem) => void;
  tab: ScheduleTab;
}) {
  const [label, setLabel] = useState("");
  const [time, setTime] = useState("09:00");
  const [days, setDays] = useState<number[]>(
    tab.kind === "week" ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5]
  );

  const toggleDay = (d: number) => {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  };

  const handleAdd = () => {
    if (!label.trim() || days.length === 0) return;
    const item: ScheduleItem = {
      id: uid(),
      time,
      label: label.trim(),
      days,
      done: new Array(7).fill(false),
    };
    onAdd(item);
    // Schedule reminder
    if (days.includes(todayDayIndex())) scheduleReminder(label.trim(), time);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-5"
        style={{ background: "var(--paper)", border: "1px solid var(--line)" }}
      >
        <h2 className="text-lg font-bold" style={{ fontFamily: "Fraunces, serif" }}>
          Add Reminder
        </h2>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            What to do
          </label>
          <input
            autoFocus
            type="text"
            placeholder="e.g. Morning workout"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="w-full px-4 py-2.5 rounded-xl text-sm"
            style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink)" }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Time
          </label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl text-sm"
            style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink)" }}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Repeat on days
          </label>
          <div className="flex gap-1.5 flex-wrap">
            {DAY_NAMES.map((name, i) => (
              <button
                key={i}
                onClick={() => toggleDay(i)}
                className="w-10 h-10 rounded-xl text-xs font-bold transition-all"
                style={{
                  background: days.includes(i) ? "var(--accent)" : "var(--panel)",
                  color: days.includes(i) ? "#fff" : "var(--muted)",
                  border: `1.5px solid ${days.includes(i) ? "var(--accent)" : "var(--line)"}`,
                }}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink)" }}
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={!label.trim() || days.length === 0}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
            style={{ background: "var(--accent)" }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Today Banner ─────────────────────────────────────────────────────────────

function TodayBanner({ tab }: { tab: ScheduleTab }) {
  const today = new Date();
  const todayDow = today.getDay();

  const todayItems = tab.items
    .filter((item) => item.days.includes(todayDow))
    .sort((a, b) => a.time.localeCompare(b.time));

  const isActive =
    tab.kind === "week"
      ? todayColForWeek(tab.startDate) !== null
      : todayInMonth(tab.startDate);

  if (!isActive || todayItems.length === 0) return null;

  return (
    <div
      className="rounded-2xl p-4 mb-6"
      style={{ background: "var(--accent)18", border: "1.5px solid var(--accent)44" }}
    >
      <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "var(--accent)" }}>
        📅 Today — {DAY_FULL[todayDow]}, {MONTH_NAMES[today.getMonth()]} {today.getDate()}
      </p>
      <div className="flex flex-col gap-2">
        {todayItems.map((item) => (
          <div key={item.id} className="flex items-center gap-3 text-sm">
            <span className="font-mono text-xs px-2 py-0.5 rounded-lg" style={{ background: "var(--accent)22", color: "var(--accent)" }}>
              {item.time}
            </span>
            <span style={{ color: "var(--ink)" }}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Week View ────────────────────────────────────────────────────────────────

function WeekView({
  tab,
  onToggleDone,
  onDeleteItem,
}: {
  tab: ScheduleTab;
  onToggleDone: (itemId: string, col: number) => void;
  onDeleteItem: (itemId: string) => void;
}) {
  const weekDates = getWeekDates(tab.startDate); // Mon–Sun
  const todayCol = todayColForWeek(tab.startDate);

  // Sort items by time
  const sorted = [...tab.items].sort((a, b) => a.time.localeCompare(b.time));

  if (sorted.length === 0) {
    return (
      <div className="text-center py-16" style={{ color: "var(--muted)" }}>
        <div className="text-5xl mb-4">📋</div>
        <p className="font-medium">No reminders yet</p>
        <p className="text-sm mt-1">Tap "+ Add Reminder" to get started</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full min-w-[560px] border-collapse">
        <thead>
          <tr>
            <th className="text-left pb-3 pr-4 text-xs font-semibold uppercase tracking-wider w-28" style={{ color: "var(--muted)" }}>
              Time / Task
            </th>
            {weekDates.map((date, i) => {
              const d = parseIso(date);
              const isToday = i === todayCol;
              return (
                <th
                  key={date}
                  className="pb-3 text-center text-xs font-bold w-14"
                  style={{ color: isToday ? "var(--accent)" : "var(--muted)" }}
                >
                  <div>{DAY_NAMES[(i + 1) % 7]}</div>
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center mx-auto mt-1 text-sm"
                    style={{
                      background: isToday ? "var(--accent)" : "transparent",
                      color: isToday ? "#fff" : "var(--ink)",
                      fontWeight: isToday ? 700 : 500,
                    }}
                  >
                    {d.getDate()}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((item) => (
            <tr key={item.id} className="group border-t" style={{ borderColor: "var(--line)" }}>
              <td className="py-3 pr-4">
                <div className="flex items-start gap-2">
                  <button
                    onClick={() => onDeleteItem(item.id)}
                    className="opacity-0 group-hover:opacity-100 text-xs mt-0.5 shrink-0 transition-opacity"
                    style={{ color: "var(--muted)" }}
                    title="Delete reminder"
                  >
                    ✕
                  </button>
                  <div>
                    <div className="text-sm font-medium" style={{ color: "var(--ink)" }}>{item.label}</div>
                    <div className="text-xs font-mono mt-0.5" style={{ color: "var(--muted)" }}>{item.time}</div>
                  </div>
                </div>
              </td>
              {weekDates.map((_, colIdx) => {
                // colIdx 0=Mon … 6=Sun; day-of-week: Mon=1 … Sun=0
                const dow = colIdx === 6 ? 0 : colIdx + 1;
                const active = item.days.includes(dow);
                const done = item.done[colIdx] ?? false;
                const isToday = colIdx === todayCol;
                return (
                  <td key={colIdx} className="py-3 text-center">
                    {active ? (
                      <button
                        onClick={() => onToggleDone(item.id, colIdx)}
                        className="w-8 h-8 rounded-xl mx-auto flex items-center justify-center text-sm transition-all"
                        style={{
                          background: done
                            ? "var(--success)"
                            : isToday
                            ? "var(--accent)18"
                            : "var(--panel)",
                          border: `1.5px solid ${done ? "var(--success)" : isToday ? "var(--accent)" : "var(--line)"}`,
                          color: done ? "#fff" : "var(--muted)",
                        }}
                        title={done ? "Mark undone" : "Mark done"}
                      >
                        {done ? "✓" : "·"}
                      </button>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--line-strong)" }}>—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Month View ───────────────────────────────────────────────────────────────

function MonthView({
  tab,
  onDeleteItem,
}: {
  tab: ScheduleTab;
  onDeleteItem: (itemId: string) => void;
}) {
  const days = getDaysInMonth(tab.startDate);
  const today = todayIso();
  const [selectedDate, setSelectedDate] = useState<string | null>(
    todayInMonth(tab.startDate) ? today : null
  );

  // Build calendar grid (fill leading blanks)
  const firstDow = days[0].dayOfWeek; // 0=Sun
  const blanks = firstDow;

  const itemsForDate = (date: string) => {
    const dow = parseIso(date).getDay();
    return tab.items
      .filter((item) => item.days.includes(dow))
      .sort((a, b) => a.time.localeCompare(b.time));
  };

  const selectedItems = selectedDate ? itemsForDate(selectedDate) : [];

  return (
    <div className="flex flex-col gap-6">
      {/* Calendar grid */}
      <div>
        {/* Day headers */}
        <div className="grid grid-cols-7 mb-2">
          {DAY_NAMES.map((d) => (
            <div key={d} className="text-center text-xs font-bold uppercase tracking-wider py-1" style={{ color: "var(--muted)" }}>
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: blanks }).map((_, i) => (
            <div key={`b${i}`} />
          ))}
          {days.map(({ date }) => {
            const d = parseIso(date);
            const isToday = date === today;
            const hasItems = itemsForDate(date).length > 0;
            const isSelected = selectedDate === date;
            return (
              <button
                key={date}
                onClick={() => setSelectedDate(isSelected ? null : date)}
                className="aspect-square flex flex-col items-center justify-center rounded-xl text-sm font-medium transition-all relative"
                style={{
                  background: isSelected
                    ? "var(--accent)"
                    : isToday
                    ? "var(--accent)18"
                    : "var(--panel)",
                  border: `1.5px solid ${isSelected ? "var(--accent)" : isToday ? "var(--accent)" : "var(--line)"}`,
                  color: isSelected ? "#fff" : "var(--ink)",
                }}
              >
                {d.getDate()}
                {hasItems && (
                  <span
                    className="w-1.5 h-1.5 rounded-full absolute bottom-1"
                    style={{ background: isSelected ? "#fff" : "var(--accent)" }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected day detail */}
      {selectedDate && (
        <div
          className="rounded-2xl p-5"
          style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
        >
          <p className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: "var(--muted)" }}>
            {DAY_FULL[parseIso(selectedDate).getDay()]},{" "}
            {MONTH_NAMES[parseIso(selectedDate).getMonth()]} {parseIso(selectedDate).getDate()}
          </p>
          {selectedItems.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>No reminders for this day.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {selectedItems.map((item) => (
                <div key={item.id} className="flex items-center gap-3 group">
                  <span
                    className="font-mono text-xs px-2 py-1 rounded-lg shrink-0"
                    style={{ background: "var(--accent)18", color: "var(--accent)" }}
                  >
                    {item.time}
                  </span>
                  <span className="flex-1 text-sm" style={{ color: "var(--ink)" }}>{item.label}</span>
                  <button
                    onClick={() => onDeleteItem(item.id)}
                    className="opacity-0 group-hover:opacity-100 text-xs transition-opacity"
                    style={{ color: "var(--muted)" }}
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* All reminders list */}
      {tab.items.length > 0 && (
        <div
          className="rounded-2xl p-5"
          style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
        >
          <p className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: "var(--muted)" }}>
            All Reminders This Month
          </p>
          <div className="flex flex-col gap-3">
            {[...tab.items]
              .sort((a, b) => a.time.localeCompare(b.time))
              .map((item) => (
                <div key={item.id} className="flex items-center gap-3 group">
                  <span
                    className="font-mono text-xs px-2 py-1 rounded-lg shrink-0"
                    style={{ background: "var(--accent)18", color: "var(--accent)" }}
                  >
                    {item.time}
                  </span>
                  <div className="flex-1">
                    <div className="text-sm font-medium" style={{ color: "var(--ink)" }}>{item.label}</div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                      {item.days.map((d) => DAY_NAMES[d]).join(", ")}
                    </div>
                  </div>
                  <button
                    onClick={() => onDeleteItem(item.id)}
                    className="opacity-0 group-hover:opacity-100 text-xs transition-opacity"
                    style={{ color: "var(--muted)" }}
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      {tab.items.length === 0 && (
        <div className="text-center py-10" style={{ color: "var(--muted)" }}>
          <div className="text-5xl mb-4">🗓️</div>
          <p className="font-medium">No reminders yet</p>
          <p className="text-sm mt-1">Tap "+ Add Reminder" to get started</p>
        </div>
      )}
    </div>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────

export default function App() {
  const [data, setData] = useState<AppData>(loadData);
  const [showNewTab, setShowNewTab] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const activeTab = useMemo(
    () => data.tabs.find((t) => t.id === data.activeTabId) ?? data.tabs[0] ?? null,
    [data]
  );

  // Request notification permission on mount
  useEffect(() => {
    requestNotifPermission();
  }, []);

  const update = useCallback((next: AppData) => {
    setData(next);
    saveData(next);
  }, []);

  const addTab = (tab: ScheduleTab) => {
    update({ tabs: [...data.tabs, tab], activeTabId: tab.id });
  };

  const deleteTab = (id: string) => {
    const remaining = data.tabs.filter((t) => t.id !== id);
    update({
      tabs: remaining,
      activeTabId:
        data.activeTabId === id ? (remaining[remaining.length - 1]?.id ?? null) : data.activeTabId,
    });
    setConfirmDeleteId(null);
  };

  const addItem = (item: ScheduleItem) => {
    if (!activeTab) return;
    update({
      ...data,
      tabs: data.tabs.map((t) =>
        t.id === activeTab.id ? { ...t, items: [...t.items, item] } : t
      ),
    });
  };

  const deleteItem = (itemId: string) => {
    if (!activeTab) return;
    update({
      ...data,
      tabs: data.tabs.map((t) =>
        t.id === activeTab.id ? { ...t, items: t.items.filter((i) => i.id !== itemId) } : t
      ),
    });
  };

  const toggleDone = (itemId: string, col: number) => {
    if (!activeTab) return;
    update({
      ...data,
      tabs: data.tabs.map((t) =>
        t.id === activeTab.id
          ? {
              ...t,
              items: t.items.map((item) =>
                item.id === itemId
                  ? {
                      ...item,
                      done: item.done.map((v, i) => (i === col ? !v : v)),
                    }
                  : item
              ),
            }
          : t
      ),
    });
  };

  return (
    <Shell appName="Scheduler">
      <div className="max-w-3xl mx-auto flex flex-col gap-0">

        {/* Header row */}
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold" style={{ fontFamily: "Fraunces, serif" }}>
              My Schedule
            </h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--muted)" }}>
              {data.tabs.length === 0
                ? "Create your first schedule tab"
                : `${data.tabs.length} tab${data.tabs.length > 1 ? "s" : ""}`}
            </p>
          </div>
          <div className="flex gap-2">
            {activeTab && (
              <button
                onClick={() => setShowAddItem(true)}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ background: "var(--accent)" }}
              >
                + Add Reminder
              </button>
            )}
            <button
              onClick={() => setShowNewTab(true)}
              className="px-4 py-2 rounded-xl text-sm font-semibold"
              style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink)" }}
            >
              + New Tab
            </button>
          </div>
        </div>

        {/* Tabs bar */}
        {data.tabs.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 mb-6 -mx-1 px-1">
            {data.tabs.map((tab) => {
              const isActive = tab.id === (activeTab?.id ?? "");
              return (
                <div
                  key={tab.id}
                  className="flex items-center gap-1.5 shrink-0 rounded-xl px-3 py-2 transition-all"
                  style={{
                    background: isActive ? "var(--accent)" : "var(--panel)",
                    border: `1.5px solid ${isActive ? "var(--accent)" : "var(--line)"}`,
                  }}
                >
                  <button
                    onClick={() => update({ ...data, activeTabId: tab.id })}
                    className="text-sm font-semibold"
                    style={{ color: isActive ? "#fff" : "var(--ink)" }}
                  >
                    {tab.kind === "week" ? "📅" : "🗓️"} {tab.label}
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(tab.id)}
                    className="text-xs rounded-full w-4 h-4 flex items-center justify-center transition-opacity"
                    style={{ color: isActive ? "rgba(255,255,255,0.7)" : "var(--muted)" }}
                    title="Delete tab"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Empty state */}
        {data.tabs.length === 0 && (
          <div className="text-center py-24" style={{ color: "var(--muted)" }}>
            <div className="text-6xl mb-5">📅</div>
            <p className="text-lg font-bold" style={{ color: "var(--ink)", fontFamily: "Fraunces, serif" }}>
              No schedules yet
            </p>
            <p className="text-sm mt-2 mb-6">Create a weekly or monthly tab to get started</p>
            <button
              onClick={() => setShowNewTab(true)}
              className="px-6 py-3 rounded-xl text-sm font-semibold text-white"
              style={{ background: "var(--accent)" }}
            >
              + Create First Tab
            </button>
          </div>
        )}

        {/* Active tab content */}
        {activeTab && (
          <>
            <TodayBanner tab={activeTab} />
            {activeTab.kind === "week" ? (
              <WeekView tab={activeTab} onToggleDone={toggleDone} onDeleteItem={deleteItem} />
            ) : (
              <MonthView tab={activeTab} onDeleteItem={deleteItem} />
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {showNewTab && <NewTabModal onClose={() => setShowNewTab(false)} onAdd={addTab} />}
      {showAddItem && activeTab && (
        <AddItemModal onClose={() => setShowAddItem(false)} onAdd={addItem} tab={activeTab} />
      )}

      {/* Delete tab confirm */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.45)" }}
        >
          <div
            className="w-full max-w-xs rounded-2xl p-6 flex flex-col gap-4"
            style={{ background: "var(--paper)", border: "1px solid var(--line)" }}
          >
            <h2 className="text-base font-bold" style={{ fontFamily: "Fraunces, serif" }}>
              Delete this tab?
            </h2>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              All reminders in this tab will be permanently removed.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink)" }}
              >
                Cancel
              </button>
              <button
                onClick={() => deleteTab(confirmDeleteId)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                style={{ background: "var(--error)" }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
