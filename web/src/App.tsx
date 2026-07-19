import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Shell } from "./components/Shell";

// ─── Types ────────────────────────────────────────────────────────────────────

type NavPage = "week" | "month" | "reminders";

interface Reminder {
  id: string;
  title: string;
  time: string;       // "HH:MM"
  days: number[];     // 0=Sun … 6=Sat
  color: string;
}

interface AppData {
  reminders: Reminder[];
  weekOffset: number;
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

const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

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
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
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

function hourToTime(hour: number, minute = 0): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// ─── Notification sound (Web Audio API) ──────────────────────────────────────

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

    const playTone = (freq: number, startTime: number, duration: number, gain: number) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime);
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const t = ctx.currentTime;
    playTone(880, t, 0.3, 0.4);
    playTone(1100, t + 0.18, 0.3, 0.35);
    playTone(1320, t + 0.36, 0.5, 0.3);

    setTimeout(() => ctx.close(), 1500);
  } catch {}
}

// ─── Notification checker hook ────────────────────────────────────────────────

function useNotificationChecker(reminders: Reminder[]) {
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const check = () => {
      const now = new Date();
      const dow = now.getDay();
      const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const key = `${isoDate(now)}-${currentTime}`;

      reminders.forEach((r) => {
        if (r.days.includes(dow) && r.time === currentTime) {
          const fireKey = `${r.id}-${key}`;
          if (!firedRef.current.has(fireKey)) {
            firedRef.current.add(fireKey);
            playNotificationSound();

            if ("Notification" in window && Notification.permission === "granted") {
              new Notification(`⏰ ${r.title}`, {
                body: `Scheduled for ${fmt12(r.time)}`,
                icon: "/manifest.json",
              });
            }
          }
        }
      });
    };

    check();
    const interval = setInterval(check, 30_000); // check every 30s
    return () => clearInterval(interval);
  }, [reminders]);
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── Quick Add Modal — minute picker + title + color ─────────────────────────

function QuickAddModal({
  onClose,
  onAdd,
  prefillHour,
  prefillDays,
}: {
  onClose: () => void;
  onAdd: (r: Reminder) => void;
  prefillHour: number;
  prefillDays: number[];
}) {
  const [title, setTitle] = useState("");
  const [minute, setMinute] = useState(0);
  const [color, setColor] = useState(COLORS[0]);

  const time = hourToTime(prefillHour, minute);

  const handleAdd = () => {
    if (!title.trim()) return;
    onAdd({ id: uid(), title: title.trim(), time, days: prefillDays, color });
    onClose();
  };

  const hourLabel = prefillHour === 12
    ? "12pm"
    : prefillHour > 12
    ? `${prefillHour - 12}pm`
    : `${prefillHour}am`;

  const displayDays = prefillDays.map((d) => DAY_FULL[d]).join(", ");

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
        {/* Header */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--muted)" }}>
            {displayDays}
          </p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold font-mono" style={{ color: "var(--accent)", fontFamily: "Fraunces, serif" }}>
              {hourLabel}
            </span>
            <span className="text-lg font-bold font-mono" style={{ color: "var(--ink)" }}>
              :{String(minute).padStart(2, "0")}
            </span>
          </div>
        </div>

        {/* Minute picker */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Pick minute
          </label>
          <div className="grid grid-cols-6 gap-1.5">
            {MINUTES.map((m) => (
              <button
                key={m}
                onClick={() => setMinute(m)}
                className="py-2 rounded-xl text-sm font-bold transition-all"
                style={{
                  background: minute === m ? color : "var(--panel)",
                  color: minute === m ? "#fff" : "var(--ink)",
                  border: `1.5px solid ${minute === m ? color : "var(--line)"}`,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                :{String(m).padStart(2, "0")}
              </button>
            ))}
          </div>
        </div>

        {/* Title */}
        <input
          autoFocus
          type="text"
          placeholder="What's happening?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="w-full px-4 py-3 rounded-xl text-sm outline-none font-medium"
          style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink)" }}
        />

        {/* Color */}
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
                transform: color === c ? "scale(1.2)" : "scale(1)",
              }}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink)" }}
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={!title.trim()}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
            style={{ background: color }}
          >
            Add at {fmt12(time)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Full Add Reminder Modal (reminders page) ─────────────────────────────────

function AddReminderModal({ onClose, onAdd }: { onClose: () => void; onAdd: (r: Reminder) => void }) {
  const [title, setTitle] = useState("");
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [color, setColor] = useState(COLORS[0]);

  const toggleDay = (d: number) =>
    setDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort());

  const time = hourToTime(hour, minute);

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
        className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--paper)", border: "1px solid var(--line)" }}
      >
        <h2 className="text-lg font-bold" style={{ fontFamily: "Fraunces, serif" }}>Add Reminder</h2>

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

        {/* Hour picker */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Hour</label>
          <div className="grid grid-cols-6 gap-1">
            {Array.from({ length: 18 }, (_, i) => i + 5).map((h) => {
              const label = h === 12 ? "12p" : h > 12 ? `${h-12}p` : `${h}a`;
              return (
                <button
                  key={h}
                  onClick={() => setHour(h)}
                  className="py-1.5 rounded-lg text-xs font-bold transition-all"
                  style={{
                    background: hour === h ? color : "var(--panel)",
                    color: hour === h ? "#fff" : "var(--ink)",
                    border: `1px solid ${hour === h ? color : "var(--line)"}`,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Minute picker */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Minute</label>
          <div className="grid grid-cols-6 gap-1.5">
            {MINUTES.map((m) => (
              <button
                key={m}
                onClick={() => setMinute(m)}
                className="py-2 rounded-xl text-sm font-bold transition-all"
                style={{
                  background: minute === m ? color : "var(--panel)",
                  color: minute === m ? "#fff" : "var(--ink)",
                  border: `1.5px solid ${minute === m ? color : "var(--line)"}`,
                }}
              >
                :{String(m).padStart(2, "0")}
              </button>
            ))}
          </div>
        </div>

        {/* Days */}
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

        {/* Color */}
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

        <div className="flex gap-3">
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
            Add at {fmt12(time)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Week View ────────────────────────────────────────────────────────────────

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6);

function WeekView({ data, onChange }: { data: AppData; onChange: (d: AppData) => void }) {
  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);

  const monday = useMemo(() => {
    const m = getMondayOf(new Date());
    m.setDate(m.getDate() + data.weekOffset * 7);
    return m;
  }, [data.weekOffset]);

  const days = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);

  const [quickAdd, setQuickAdd] = useState<{ hour: number; days: number[] } | null>(null);

  const remindersForDayHour = (dow: number, hour: number) =>
    data.reminders
      .filter((r) => r.days.includes(dow) && parseInt(r.time.split(":")[0]) === hour)
      .sort((a, b) => a.time.localeCompare(b.time));

  const weekLabel = useMemo(() => {
    const end = addDays(monday, 6);
    const sameMonth = monday.getMonth() === end.getMonth();
    if (sameMonth) return `${MONTH_NAMES[monday.getMonth()]} ${monday.getDate()}–${end.getDate()}, ${monday.getFullYear()}`;
    return `${MONTH_NAMES[monday.getMonth()].slice(0,3)} ${monday.getDate()} – ${MONTH_NAMES[end.getMonth()].slice(0,3)} ${end.getDate()}, ${end.getFullYear()}`;
  }, [monday]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <button
          onClick={() => onChange({ ...data, weekOffset: data.weekOffset - 1 })}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold"
          style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink)" }}
        >‹</button>
        <div className="text-center">
          <p className="text-sm font-bold" style={{ color: "var(--ink)" }}>{weekLabel}</p>
          {data.weekOffset !== 0 && (
            <button onClick={() => onChange({ ...data, weekOffset: 0 })} className="text-xs font-medium mt-0.5" style={{ color: "var(--accent)" }}>
              Back to today
            </button>
          )}
        </div>
        <button
          onClick={() => onChange({ ...data, weekOffset: data.weekOffset + 1 })}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold"
          style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink)" }}
        >›</button>
      </div>

      <p className="text-xs text-center" style={{ color: "var(--muted)" }}>
        Tap any row to add a reminder — then pick the exact minute
      </p>

      <div className="overflow-x-auto -mx-4 px-4">
        <div className="min-w-[600px]">
          {/* Day headers */}
          <div className="grid grid-cols-[3.5rem_repeat(7,1fr)] mb-1">
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
                    className="w-8 h-8 rounded-full flex items-center justify-center mx-auto mt-1 text-sm font-bold"
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
          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--line)" }}>
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="grid grid-cols-[3.5rem_repeat(7,1fr)] border-b last:border-b-0"
                style={{ borderColor: "var(--line)", minHeight: "3.25rem" }}
              >
                <div
                  className="flex items-start justify-end pr-2 pt-2 text-xs font-mono shrink-0 select-none"
                  style={{ color: "var(--muted)", borderRight: "1px solid var(--line)" }}
                >
                  {hour === 12 ? "12pm" : hour > 12 ? `${hour - 12}pm` : `${hour}am`}
                </div>

                {days.map((day, colIdx) => {
                  const dow = day.getDay();
                  const isToday = sameDay(day, today);
                  const cellReminders = remindersForDayHour(dow, hour);
                  return (
                    <div
                      key={colIdx}
                      className="relative p-1 border-l cursor-pointer group"
                      style={{
                        borderColor: "var(--line)",
                        background: isToday ? "var(--accent)08" : "transparent",
                      }}
                      onClick={() => setQuickAdd({ hour, days: [dow] })}
                      title={`Add at ${hour > 12 ? hour - 12 : hour}${hour >= 12 ? "pm" : "am"} on ${DAY_FULL[dow]}`}
                    >
                      {/* Hover hint */}
                      <div
                        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none"
                        style={{ background: "var(--accent)10" }}
                      >
                        <span style={{ color: "var(--accent)", fontSize: "1.1rem", fontWeight: 700 }}>+</span>
                      </div>

                      {cellReminders.map((r) => (
                        <div
                          key={r.id}
                          className="rounded-lg px-1.5 py-0.5 text-xs font-semibold text-white mb-0.5 truncate relative z-10"
                          style={{ background: r.color }}
                          title={`${r.title} at ${fmt12(r.time)}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="opacity-70 mr-0.5">:{r.time.split(":")[1]}</span>{r.title}
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

      {quickAdd && (
        <QuickAddModal
          prefillHour={quickAdd.hour}
          prefillDays={quickAdd.days}
          onClose={() => setQuickAdd(null)}
          onAdd={(r) => {
            onChange({ ...data, reminders: [...data.reminders, r] });
            setQuickAdd(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Month View ───────────────────────────────────────────────────────────────

function MonthView({ data, onChange }: { data: AppData; onChange: (d: AppData) => void }) {
  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date(today));
  const [quickAdd, setQuickAdd] = useState<{ hour: number; days: number[] } | null>(null);

  const { year, month } = useMemo(() => {
    const d = new Date(today.getFullYear(), today.getMonth() + data.monthOffset, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  }, [data.monthOffset, today]);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay();
  const startBlanks = firstDow === 0 ? 6 : firstDow - 1;

  const calDays = useMemo(() =>
    Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
    [year, month, daysInMonth]);

  const remindersForDow = (dow: number) =>
    data.reminders.filter((r) => r.days.includes(dow)).sort((a, b) => a.time.localeCompare(b.time));

  const selectedReminders = selectedDate ? remindersForDow(selectedDate.getDay()) : [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <button
          onClick={() => onChange({ ...data, monthOffset: data.monthOffset - 1 })}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold"
          style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink)" }}
        >‹</button>
        <div className="text-center">
          <p className="text-sm font-bold" style={{ color: "var(--ink)" }}>{MONTH_NAMES[month]} {year}</p>
          {data.monthOffset !== 0 && (
            <button onClick={() => onChange({ ...data, monthOffset: 0 })} className="text-xs font-medium mt-0.5" style={{ color: "var(--accent)" }}>
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

      <div className="grid grid-cols-7 gap-1">
        {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => (
          <div key={d} className="text-center text-xs font-bold uppercase tracking-wider py-1" style={{ color: "var(--muted)" }}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: startBlanks }).map((_, i) => <div key={`b${i}`} />)}
        {calDays.map((day) => {
          const dow = day.getDay();
          const isToday = sameDay(day, today);
          const isSelected = selectedDate ? sameDay(day, selectedDate) : false;
          const dayReminders = remindersForDow(dow).slice(0, 2);
          const extra = remindersForDow(dow).length - 2;

          return (
            <button
              key={day.toISOString()}
              onClick={() => setSelectedDate(isSelected ? null : day)}
              className="rounded-xl p-1 flex flex-col items-center gap-0.5 transition-all min-h-[3.5rem]"
              style={{
                background: isSelected ? "var(--accent)" : isToday ? "var(--accent)15" : "var(--panel)",
                border: `1.5px solid ${isSelected ? "var(--accent)" : isToday ? "var(--accent)" : "var(--line)"}`,
              }}
            >
              <span className="text-sm font-bold" style={{ color: isSelected ? "#fff" : isToday ? "var(--accent)" : "var(--ink)" }}>
                {day.getDate()}
              </span>
              {dayReminders.map((r) => (
                <div
                  key={r.id}
                  className="w-full rounded text-white text-center"
                  style={{ background: isSelected ? "rgba(255,255,255,0.3)" : r.color, fontSize: "9px", padding: "1px 3px" }}
                >
                  {r.title.length > 7 ? r.title.slice(0, 6) + "…" : r.title}
                </div>
              ))}
              {extra > 0 && (
                <div style={{ fontSize: "9px", color: isSelected ? "rgba(255,255,255,0.7)" : "var(--muted)" }}>+{extra}</div>
              )}
            </button>
          );
        })}
      </div>

      {selectedDate && (
        <div className="rounded-2xl p-5" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}>
          <div className="flex items-center justify-between mb-4">
            <p className="font-bold" style={{ fontFamily: "Fraunces, serif" }}>
              {DAY_FULL[selectedDate.getDay()]}, {MONTH_NAMES[selectedDate.getMonth()]} {selectedDate.getDate()}
            </p>
            <button
              onClick={() => setQuickAdd({ hour: 9, days: [selectedDate.getDay()] })}
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

      {quickAdd && (
        <QuickAddModal
          prefillHour={quickAdd.hour}
          prefillDays={quickAdd.days}
          onClose={() => setQuickAdd(null)}
          onAdd={(r) => {
            onChange({ ...data, reminders: [...data.reminders, r] });
            setQuickAdd(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Reminders List ───────────────────────────────────────────────────────────

function RemindersPage({ data, onChange }: { data: AppData; onChange: (d: AppData) => void }) {
  const [showModal, setShowModal] = useState(false);

  const deleteReminder = (id: string) =>
    onChange({ ...data, reminders: data.reminders.filter((r) => r.id !== id) });

  const sorted = [...data.reminders].sort((a, b) => a.time.localeCompare(b.time));
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
        <button onClick={() => setShowModal(true)} className="px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: "var(--accent)" }}>
          + Add
        </button>
      </div>

      {todayReminders.length > 0 && (
        <div className="rounded-2xl p-5" style={{ background: "var(--accent)12", border: "1.5px solid var(--accent)33" }}>
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

      {sorted.length === 0 ? (
        <div className="text-center py-20" style={{ color: "var(--muted)" }}>
          <div className="text-5xl mb-4">🔔</div>
          <p className="font-bold text-base" style={{ color: "var(--ink)", fontFamily: "Fraunces, serif" }}>No reminders yet</p>
          <p className="text-sm mt-1 mb-6">Tap any hour slot in the Week view to add one</p>
          <button onClick={() => setShowModal(true)} className="px-6 py-3 rounded-xl text-sm font-semibold text-white" style={{ background: "var(--accent)" }}>
            + Add Reminder
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

  // Request notification permission on load
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const handleChange = useCallback((next: AppData) => {
    setData(next);
    saveData(next);
  }, []);

  // Live notification checker
  useNotificationChecker(data.reminders);

  return (
    <Shell
      appName="Scheduler"
      navItems={NAV_ITEMS}
      activeNav={page}
      onNavChange={(id) => setPage(id as NavPage)}
    >
      {page === "week" && <WeekView data={data} onChange={handleChange} />}
      {page === "month" && <MonthView data={data} onChange={handleChange} />}
      {page === "reminders" && <RemindersPage data={data} onChange={handleChange} />}
    </Shell>
  );
}
