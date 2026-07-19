import { useState, useEffect, useCallback, useMemo } from "react";
import { Shell } from "./components/Shell";

// ─── Types ────────────────────────────────────────────────────────────────────

type NavPage = "week" | "month" | "reminders";

interface Reminder {
  id: string;
  title: string;
  time: string;       // "HH:MM"
  days: number[];     // 0=Sun … 6=Sat (recurring)
  color: string;
}

interface AppData {
  reminders: Reminder[];
  weekOffset: number;   // 0 = current week, -1 = last week, +1 = next week
  monthOffset: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "scheduleapp_v2";

const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const COLORS = [
  "#2563eb", "#16a34a", "#d97706", "#dc2626",
  "#8b5cf6", "#0891b2", "#db2777", "#65a30d",
];

const NAV_ITEMS = [
  { id: "week",      label: "Week",      icon: "📅" },
  { id: "month",     label: "Month",     icon: "🗓️" },
  { id: "reminders", label: "Reminders", icon: "🔔" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { weekOffset: 0, monthOffset: 0, ...JSON.parse(raw) };
  } catch {}
  return { reminders: [], weekOffset: 0, monthOffset: 0 };
}

function saveData(d: AppData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
}

function getMondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function fmt12(time: string) {
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")}${ampm}`;
}

// ─── Add Reminder Modal ───────────────────────────────────────────────────────

function AddReminderModal({
  onClose,
  onAdd,
  initial,
}: {
  onClose: () => void;
  onAdd: (r: Reminder) => void;
  initial?: { days?: number[] };
}) {
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("09:00");
  const [days, setDays] = useState<number[]>(initial?.days ?? [1, 2, 3, 4, 5]);
  const [color, setColor] = useState(COLORS[0]);

  const toggleDay = (d: number) =>
    setDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort());

  const handleAdd = () => {
    if (!title.trim() || days.length === 0) return;
    onAdd({ id: uid(), title: title.trim(), time, days, color });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-5"
        style={{ background: "var(--paper)", border: "1px solid var(--line)" }}
      >
        <h2 className="text-lg font-bold" style={{ fontFamily: "Fraunces, serif" }}>
          Add Reminder
        </h2>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Title</label>
          <input
            autoFocus
            type="text"
            placeholder="e.g. Morning workout"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink)" }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Time</label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink)" }}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Repeat on</label>
          <div className="flex gap-1.5">
            {DAY_SHORT.map((name, i) => (
              <button
                key={i}
                onClick={() => toggleDay(i)}
                className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
                style={{
                  background: days.includes(i) ? color : "var(--panel)",
                  color: days.includes(i) ? "#fff" : "var(--muted)",
                  border: `1.5px solid ${days.includes(i) ? color : "var(--line)"}`,
                }}
              >
                {name[0]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Color</label>
          <div className="flex gap-2 flex-wrap">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className="w-7 h-7 rounded-full transition-transform"
                style={{
                  background: c,
                  outline: color === c ? `3px solid ${c}` : "none",
                  outlineOffset: "2px",
                  transform: color === c ? "scale(1.15)" : "scale(1)",
                }}
              />
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
            disabled={!title.trim() || days.length === 0}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
            style={{ background: color }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Week View ────────────────────────────────────────────────────────────────

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 6am–10pm

function WeekView({ data, onChange }: { data: AppData; onChange: (d: AppData) => void }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const monday = useMemo(() => {
    const m = getMondayOf(new Date());
    m.setDate(m.getDate() + data.weekOffset * 7);
    return m;
  }, [data.weekOffset]);

  // Mon–Sun columns
  const days = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => addDays(monday, i)),
    [monday]
  );

  const [showModal, setShowModal] = useState(false);
  const [modalDays, setModalDays] = useState<number[]>([]);

  const remindersForDay = (dow: number) =>
    data.reminders
      .filter((r) => r.days.includes(dow))
      .sort((a, b) => a.time.localeCompare(b.time));

  const weekLabel = useMemo(() => {
    const end = addDays(monday, 6);
    const sameMonth = monday.getMonth() === end.getMonth();
    if (sameMonth) {
      return `${MONTH_NAMES[monday.getMonth()]} ${monday.getDate()}–${end.getDate()}, ${monday.getFullYear()}`;
    }
    return `${MONTH_NAMES[monday.getMonth()].slice(0,3)} ${monday.getDate()} – ${MONTH_NAMES[end.getMonth()].slice(0,3)} ${end.getDate()}, ${end.getFullYear()}`;
  }, [monday]);

  return (
    <div className="flex flex-col gap-4">
      {/* Nav row */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => onChange({ ...data, weekOffset: data.weekOffset - 1 })}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold transition-colors"
          style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink)" }}
        >‹</button>
        <div className="text-center">
          <p className="text-sm font-bold" style={{ color: "var(--ink)" }}>{weekLabel}</p>
          {data.weekOffset !== 0 && (
            <button
              onClick={() => onChange({ ...data, weekOffset: 0 })}
              className="text-xs font-medium mt-0.5"
              style={{ color: "var(--accent)" }}
            >
              Back to today
            </button>
          )}
        </div>
        <button
          onClick={() => onChange({ ...data, weekOffset: data.weekOffset + 1 })}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold transition-colors"
          style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink)" }}
        >›</button>
      </div>

      {/* Calendar grid */}
      <div className="overflow-x-auto -mx-4 px-4">
        <div className="min-w-[640px]">
          {/* Day headers */}
          <div className="grid grid-cols-[3.5rem_repeat(7,1fr)] mb-2 gap-px">
            <div />
            {days.map((day, i) => {
              const isToday = sameDay(day, today);
              const dow = day.getDay();
              return (
                <div key={i} className="text-center pb-2">
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: isToday ? "var(--accent)" : "var(--muted)" }}>
                    {DAY_FULL[dow].slice(0, 3)}
                  </p>
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center mx-auto mt-1 text-sm font-bold"
                    style={{
                      background: isToday ? "var(--accent)" : "transparent",
                      color: isToday ? "#fff" : "var(--ink)",
                    }}
                  >
                    {day.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Hour rows */}
          <div
            className="rounded-2xl overflow-hidden"
            style={{ border: "1px solid var(--line)" }}
          >
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="grid grid-cols-[3.5rem_repeat(7,1fr)] border-b last:border-b-0"
                style={{ borderColor: "var(--line)", minHeight: "3rem" }}
              >
                {/* Hour label */}
                <div
                  className="flex items-start justify-end pr-3 pt-2 text-xs font-mono shrink-0"
                  style={{ color: "var(--muted)", borderRight: "1px solid var(--line)" }}
                >
                  {hour === 12 ? "12pm" : hour > 12 ? `${hour - 12}pm` : `${hour}am`}
                </div>

                {/* Day cells */}
                {days.map((day, colIdx) => {
                  const dow = day.getDay();
                  const isToday = sameDay(day, today);
                  const cellReminders = remindersForDay(dow).filter(
                    (r) => parseInt(r.time.split(":")[0]) === hour
                  );
                  return (
                    <div
                      key={colIdx}
                      className="relative p-1 border-l cursor-pointer group"
                      style={{
                        borderColor: "var(--line)",
                        background: isToday ? "var(--accent)08" : "transparent",
                      }}
                      onClick={() => {
                        setModalDays([dow]);
                        setShowModal(true);
                      }}
                    >
                      {cellReminders.map((r) => (
                        <div
                          key={r.id}
                          className="rounded-lg px-2 py-1 text-xs font-semibold text-white mb-0.5 truncate"
                          style={{ background: r.color }}
                          title={`${r.title} at ${fmt12(r.time)}`}
                        >
                          {r.title}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {showModal && (
        <AddReminderModal
          onClose={() => setShowModal(false)}
          onAdd={(r) => onChange({ ...data, reminders: [...data.reminders, r] })}
          initial={{ days: modalDays }}
        />
      )}
    </div>
  );
}

// ─── Month View ───────────────────────────────────────────────────────────────

function MonthView({ data, onChange }: { data: AppData; onChange: (d: AppData) => void }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date(today));
  const [showModal, setShowModal] = useState(false);

  const { year, month } = useMemo(() => {
    const d = new Date(today.getFullYear(), today.getMonth() + data.monthOffset, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  }, [data.monthOffset, today]);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay(); // 0=Sun

  // Shift so Monday is first column (0=Mon … 6=Sun)
  const startBlanks = firstDow === 0 ? 6 : firstDow - 1;

  const calDays = useMemo(() =>
    Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
    [year, month, daysInMonth]
  );

  const remindersForDow = (dow: number) =>
    data.reminders.filter((r) => r.days.includes(dow)).sort((a, b) => a.time.localeCompare(b.time));

  const selectedReminders = selectedDate
    ? remindersForDow(selectedDate.getDay())
    : [];

  return (
    <div className="flex flex-col gap-5">
      {/* Nav */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => onChange({ ...data, monthOffset: data.monthOffset - 1 })}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold"
          style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink)" }}
        >‹</button>
        <div className="text-center">
          <p className="text-sm font-bold" style={{ color: "var(--ink)" }}>
            {MONTH_NAMES[month]} {year}
          </p>
          {data.monthOffset !== 0 && (
            <button
              onClick={() => onChange({ ...data, monthOffset: 0 })}
              className="text-xs font-medium mt-0.5"
              style={{ color: "var(--accent)" }}
            >
              Back to today
            </button>
          )}
        </div>
        <button
          onClick={() => onChange({ ...data, monthOffset: data.monthOffset + 1 })}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold"
          style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink)" }}
        >›</button>
      </div>

      {/* Day-of-week headers — Mon first */}
      <div className="grid grid-cols-7 gap-1">
        {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => (
          <div key={d} className="text-center text-xs font-bold uppercase tracking-wider py-1" style={{ color: "var(--muted)" }}>
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: startBlanks }).map((_, i) => <div key={`b${i}`} />)}
        {calDays.map((day) => {
          const dow = day.getDay();
          const hasReminders = remindersForDow(dow).length > 0;
          const isToday = sameDay(day, today);
          const isSelected = selectedDate ? sameDay(day, selectedDate) : false;
          const dayReminders = remindersForDow(dow).slice(0, 3);

          return (
            <button
              key={day.toISOString()}
              onClick={() => setSelectedDate(isSelected ? null : day)}
              className="rounded-xl p-1.5 flex flex-col items-center gap-0.5 transition-all min-h-[4rem]"
              style={{
                background: isSelected
                  ? "var(--accent)"
                  : isToday
                  ? "var(--accent)15"
                  : "var(--panel)",
                border: `1.5px solid ${isSelected ? "var(--accent)" : isToday ? "var(--accent)" : "var(--line)"}`,
              }}
            >
              <span
                className="text-sm font-bold"
                style={{ color: isSelected ? "#fff" : isToday ? "var(--accent)" : "var(--ink)" }}
              >
                {day.getDate()}
              </span>
              <div className="flex flex-col gap-0.5 w-full">
                {dayReminders.map((r) => (
                  <div
                    key={r.id}
                    className="w-full rounded text-white text-center leading-tight"
                    style={{ background: isSelected ? "rgba(255,255,255,0.3)" : r.color, fontSize: "9px", padding: "1px 2px" }}
                  >
                    {r.title.length > 8 ? r.title.slice(0, 7) + "…" : r.title}
                  </div>
                ))}
                {hasReminders && remindersForDow(dow).length > 3 && (
                  <div className="text-center" style={{ fontSize: "9px", color: isSelected ? "rgba(255,255,255,0.7)" : "var(--muted)" }}>
                    +{remindersForDow(dow).length - 3} more
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected day detail */}
      {selectedDate && (
        <div
          className="rounded-2xl p-5"
          style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
        >
          <div className="flex items-center justify-between mb-4">
            <p className="font-bold" style={{ fontFamily: "Fraunces, serif" }}>
              {DAY_FULL[selectedDate.getDay()]}, {MONTH_NAMES[selectedDate.getMonth()]} {selectedDate.getDate()}
            </p>
            <button
              onClick={() => {
                setShowModal(true);
              }}
              className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white"
              style={{ background: "var(--accent)" }}
            >
              + Add
            </button>
          </div>
          {selectedReminders.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>No reminders for {DAY_FULL[selectedDate.getDay()]}s.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {selectedReminders.map((r) => (
                <div key={r.id} className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: r.color }} />
                  <span className="font-mono text-xs px-2 py-0.5 rounded-lg" style={{ background: r.color + "22", color: r.color }}>
                    {fmt12(r.time)}
                  </span>
                  <span className="flex-1 text-sm font-medium" style={{ color: "var(--ink)" }}>{r.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showModal && (
        <AddReminderModal
          onClose={() => setShowModal(false)}
          onAdd={(r) => onChange({ ...data, reminders: [...data.reminders, r] })}
          initial={{ days: selectedDate ? [selectedDate.getDay()] : undefined }}
        />
      )}
    </div>
  );
}

// ─── Reminders List ───────────────────────────────────────────────────────────

function RemindersPage({ data, onChange }: { data: AppData; onChange: (d: AppData) => void }) {
  const [showModal, setShowModal] = useState(false);

  const deleteReminder = (id: string) => {
    onChange({ ...data, reminders: data.reminders.filter((r) => r.id !== id) });
  };

  const sorted = [...data.reminders].sort((a, b) => a.time.localeCompare(b.time));

  // Today's reminders
  const todayDow = new Date().getDay();
  const todayReminders = sorted.filter((r) => r.days.includes(todayDow));

  return (
    <div className="max-w-lg mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "Fraunces, serif" }}>Reminders</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--muted)" }}>
            {data.reminders.length} total · {todayReminders.length} today
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ background: "var(--accent)" }}
        >
          + Add
        </button>
      </div>

      {/* Today banner */}
      {todayReminders.length > 0 && (
        <div
          className="rounded-2xl p-5"
          style={{ background: "var(--accent)12", border: "1.5px solid var(--accent)33" }}
        >
          <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "var(--accent)" }}>
            Today — {DAY_FULL[todayDow]}
          </p>
          <div className="flex flex-col gap-2.5">
            {todayReminders.map((r) => (
              <div key={r.id} className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: r.color }} />
                <span className="font-mono text-xs px-2 py-0.5 rounded-lg" style={{ background: r.color + "22", color: r.color }}>
                  {fmt12(r.time)}
                </span>
                <span className="flex-1 text-sm font-semibold" style={{ color: "var(--ink)" }}>{r.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All reminders */}
      {sorted.length === 0 ? (
        <div className="text-center py-20" style={{ color: "var(--muted)" }}>
          <div className="text-5xl mb-4">🔔</div>
          <p className="font-bold text-base" style={{ color: "var(--ink)", fontFamily: "Fraunces, serif" }}>No reminders yet</p>
          <p className="text-sm mt-1 mb-6">Add something to stay on schedule</p>
          <button
            onClick={() => setShowModal(true)}
            className="px-6 py-3 rounded-xl text-sm font-semibold text-white"
            style={{ background: "var(--accent)" }}
          >
            + Add First Reminder
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>All Reminders</p>
          {sorted.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-4 px-4 py-3.5 rounded-2xl group"
              style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
            >
              <div className="w-3 h-3 rounded-full shrink-0" style={{ background: r.color }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: "var(--ink)" }}>{r.title}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                  {fmt12(r.time)} · {r.days.map((d) => DAY_SHORT[d]).join(", ")}
                </p>
              </div>
              <button
                onClick={() => deleteReminder(r.id)}
                className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-opacity"
                style={{ background: "var(--line)", color: "var(--muted)" }}
                title="Delete"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <AddReminderModal
          onClose={() => setShowModal(false)}
          onAdd={(r) => onChange({ ...data, reminders: [...data.reminders, r] })}
        />
      )}
    </div>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────

export default function App() {
  const [data, setData] = useState<AppData>(loadData);
  const [page, setPage] = useState<NavPage>("week");
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const handleChange = useCallback((next: AppData) => {
    setData(next);
    saveData(next);
  }, []);

  return (
    <Shell
      appName="Scheduler"
      navItems={NAV_ITEMS}
      activeNav={page}
      onNavChange={(id) => setPage(id as NavPage)}
    >
      {/* Floating add button on week/month views */}
      {page !== "reminders" && (
        <div className="fixed bottom-24 right-6 md:bottom-8 md:right-8 z-40">
          <button
            onClick={() => setShowAddModal(true)}
            className="w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-2xl text-white transition-transform active:scale-95"
            style={{ background: "var(--accent)", boxShadow: "0 4px 24px var(--accent)55" }}
            title="Add reminder"
          >
            +
          </button>
        </div>
      )}

      {page === "week" && <WeekView data={data} onChange={handleChange} />}
      {page === "month" && <MonthView data={data} onChange={handleChange} />}
      {page === "reminders" && <RemindersPage data={data} onChange={handleChange} />}

      {showAddModal && (
        <AddReminderModal
          onClose={() => setShowAddModal(false)}
          onAdd={(r) => handleChange({ ...data, reminders: [...data.reminders, r] })}
        />
      )}
    </Shell>
  );
}
