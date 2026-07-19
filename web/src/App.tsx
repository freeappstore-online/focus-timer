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

// Pastel colours for reminders
const COLORS = [
  "#b497f5", // lavender
  "#f4a7c3", // pink
  "#7dd3c8", // mint
  "#f9c784", // peach
  "#93d4f0", // sky blue
  "#a8e6a3", // sage green
  "#f7a97a", // coral
  "#c5b4e8", // periwinkle
];

// Pastel bg tints for each colour (20% opacity version for backgrounds)
const COLOR_BG: Record<string, string> = {
  "#b497f5": "#b497f530",
  "#f4a7c3": "#f4a7c330",
  "#7dd3c8": "#7dd3c830",
  "#f9c784": "#f9c78430",
  "#93d4f0": "#93d4f030",
  "#a8e6a3": "#a8e6a330",
  "#f7a97a": "#f7a97a30",
  "#c5b4e8": "#c5b4e830",
};

const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

const NAV_ITEMS = [
  { id: "week",      label: "Week",      icon: "📅" },
  { id: "month",     label: "Month",     icon: "🗓️" },
  { id: "reminders", label: "Reminders", icon: "🔔" },
];

// Pastel gradient for each day column
const DAY_GRADIENTS = [
  "rgba(244,167,195,0.10)", // Sun - pink
  "rgba(180,151,245,0.10)", // Mon - lavender
  "rgba(147,212,240,0.10)", // Tue - sky
  "rgba(125,211,200,0.10)", // Wed - mint
  "rgba(168,230,163,0.10)", // Thu - sage
  "rgba(249,199,132,0.10)", // Fri - peach
  "rgba(247,169,122,0.10)", // Sat - coral
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

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── Notification sound ───────────────────────────────────────────────────────

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
              new Notification(`⏰ ${r.title}`, { body: `Scheduled for ${fmt12(r.time)}` });
            }
          }
        }
      });
    };
    check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, [reminders]);
}

// ─── Quick Add Modal ──────────────────────────────────────────────────────────

function QuickAddModal({
  onClose, onAdd, prefillHour, prefillDays,
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
  const hourLabel = prefillHour === 12 ? "12pm" : prefillHour > 12 ? `${prefillHour - 12}pm` : `${prefillHour}am`;
  const displayDays = prefillDays.map((d) => DAY_FULL[d]).join(", ");

  const handleAdd = () => {
    if (!title.trim()) return;
    onAdd({ id: uid(), title: title.trim(), time, days: prefillDays, color });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(30,16,48,0.55)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-3xl p-6 flex flex-col gap-5"
        style={{
          background: "linear-gradient(145deg, #fdf6ff 0%, #f3e8ff 100%)",
          border: "1.5px solid #e8d9f5",
          boxShadow: "0 20px 60px rgba(155,89,208,0.18)",
        }}
      >
        {/* Header */}
        <div
          className="rounded-2xl px-4 py-3 flex items-center gap-3"
          style={{ background: COLOR_BG[color] || "#b497f530", border: `1.5px solid ${color}44` }}
        >
          <div className="w-3 h-3 rounded-full" style={{ background: color }} />
          <div>
            <p className="text-xs font-semibold" style={{ color: "#7c6f8e" }}>{displayDays}</p>
            <p className="text-xl font-bold" style={{ color, fontFamily: "Fraunces, serif", lineHeight: 1.2 }}>
              {hourLabel} <span style={{ color: "#1e1030", fontSize: "1rem" }}>:{String(minute).padStart(2, "0")}</span>
            </p>
          </div>
        </div>

        {/* Minute picker */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold uppercase tracking-wider" style={{ color: "#7c6f8e" }}>Pick minute</label>
          <div className="grid grid-cols-6 gap-1.5">
            {MINUTES.map((m) => (
              <button
                key={m}
                onClick={() => setMinute(m)}
                className="py-2 rounded-xl text-xs font-bold transition-all"
                style={{
                  background: minute === m ? color : "#f3e8ff",
                  color: minute === m ? "#fff" : "#1e1030",
                  border: `1.5px solid ${minute === m ? color : "#e8d9f5"}`,
                  boxShadow: minute === m ? `0 2px 8px ${color}55` : "none",
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
          style={{
            background: "#fdf6ff",
            border: `1.5px solid ${title ? color : "#e8d9f5"}`,
            color: "#1e1030",
            transition: "border-color 0.2s",
          }}
        />

        {/* Color swatches */}
        <div className="flex gap-2 flex-wrap">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className="w-8 h-8 rounded-full transition-all"
              style={{
                background: c,
                outline: color === c ? `3px solid ${c}` : "none",
                outlineOffset: "2px",
                transform: color === c ? "scale(1.25)" : "scale(1)",
                boxShadow: color === c ? `0 2px 10px ${c}88` : "none",
              }}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: "#f3e8ff", border: "1.5px solid #e8d9f5", color: "#7c6f8e" }}
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={!title.trim()}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40 transition-all"
            style={{
              background: `linear-gradient(135deg, ${color}, ${color}cc)`,
              boxShadow: title.trim() ? `0 4px 14px ${color}66` : "none",
            }}
          >
            Add at {fmt12(time)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Full Add Reminder Modal ──────────────────────────────────────────────────

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
      style={{ background: "rgba(30,16,48,0.55)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-3xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto"
        style={{
          background: "linear-gradient(145deg, #fdf6ff 0%, #f3e8ff 100%)",
          border: "1.5px solid #e8d9f5",
          boxShadow: "0 20px 60px rgba(155,89,208,0.18)",
        }}
      >
        <h2 className="text-xl font-bold" style={{ fontFamily: "Fraunces, serif", color: "#1e1030" }}>
          ✨ Add Reminder
        </h2>

        <input
          autoFocus
          type="text"
          placeholder="e.g. Morning workout"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="w-full px-4 py-2.5 rounded-xl text-sm outline-none font-medium"
          style={{ background: "#fdf6ff", border: `1.5px solid ${title ? color : "#e8d9f5"}`, color: "#1e1030" }}
        />

        {/* Hour picker */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold uppercase tracking-wider" style={{ color: "#7c6f8e" }}>Hour</label>
          <div className="grid grid-cols-6 gap-1">
            {Array.from({ length: 18 }, (_, i) => i + 5).map((h) => {
              const label = h === 12 ? "12p" : h > 12 ? `${h-12}p` : `${h}a`;
              return (
                <button
                  key={h}
                  onClick={() => setHour(h)}
                  className="py-1.5 rounded-xl text-xs font-bold transition-all"
                  style={{
                    background: hour === h ? color : "#f3e8ff",
                    color: hour === h ? "#fff" : "#1e1030",
                    border: `1px solid ${hour === h ? color : "#e8d9f5"}`,
                    boxShadow: hour === h ? `0 2px 8px ${color}55` : "none",
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
          <label className="text-xs font-bold uppercase tracking-wider" style={{ color: "#7c6f8e" }}>Minute</label>
          <div className="grid grid-cols-6 gap-1.5">
            {MINUTES.map((m) => (
              <button
                key={m}
                onClick={() => setMinute(m)}
                className="py-2 rounded-xl text-xs font-bold transition-all"
                style={{
                  background: minute === m ? color : "#f3e8ff",
                  color: minute === m ? "#fff" : "#1e1030",
                  border: `1.5px solid ${minute === m ? color : "#e8d9f5"}`,
                  boxShadow: minute === m ? `0 2px 8px ${color}55` : "none",
                }}
              >
                :{String(m).padStart(2, "0")}
              </button>
            ))}
          </div>
        </div>

        {/* Days */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold uppercase tracking-wider" style={{ color: "#7c6f8e" }}>Repeat on</label>
          <div className="flex gap-1.5">
            {DAY_SHORT.map((name, i) => (
              <button
                key={i}
                onClick={() => toggleDay(i)}
                className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
                style={{
                  background: days.includes(i) ? color : "#f3e8ff",
                  color: days.includes(i) ? "#fff" : "#7c6f8e",
                  border: `1.5px solid ${days.includes(i) ? color : "#e8d9f5"}`,
                  boxShadow: days.includes(i) ? `0 2px 8px ${color}44` : "none",
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
              className="w-8 h-8 rounded-full transition-all"
              style={{
                background: c,
                outline: color === c ? `3px solid ${c}` : "none",
                outlineOffset: "2px",
                transform: color === c ? "scale(1.25)" : "scale(1)",
                boxShadow: color === c ? `0 2px 10px ${c}88` : "none",
              }}
            />
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: "#f3e8ff", border: "1.5px solid #e8d9f5", color: "#7c6f8e" }}
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={!title.trim() || days.length === 0}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40"
            style={{
              background: `linear-gradient(135deg, ${color}, ${color}cc)`,
              boxShadow: `0 4px 14px ${color}55`,
            }}
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
      {/* Nav */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => onChange({ ...data, weekOffset: data.weekOffset - 1 })}
          className="w-10 h-10 rounded-2xl flex items-center justify-center text-lg font-bold transition-all"
          style={{ background: "linear-gradient(135deg, #f3e8ff, #e8d9f5)", border: "1.5px solid #e8d9f5", color: "#9b59d0", boxShadow: "0 2px 8px #b497f530" }}
        >‹</button>
        <div className="text-center">
          <p className="text-sm font-bold" style={{ color: "var(--ink)" }}>{weekLabel}</p>
          {data.weekOffset !== 0 && (
            <button onClick={() => onChange({ ...data, weekOffset: 0 })} className="text-xs font-semibold mt-0.5" style={{ color: "#9b59d0" }}>
              Back to today
            </button>
          )}
        </div>
        <button
          onClick={() => onChange({ ...data, weekOffset: data.weekOffset + 1 })}
          className="w-10 h-10 rounded-2xl flex items-center justify-center text-lg font-bold transition-all"
          style={{ background: "linear-gradient(135deg, #f3e8ff, #e8d9f5)", border: "1.5px solid #e8d9f5", color: "#9b59d0", boxShadow: "0 2px 8px #b497f530" }}
        >›</button>
      </div>

      <p className="text-xs text-center font-medium" style={{ color: "#a98dc5" }}>
        ✨ Tap any row to add a reminder — then pick the exact minute
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
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: isToday ? "#9b59d0" : "#a98dc5" }}>
                    {DAY_FULL[dow].slice(0, 3)}
                  </p>
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center mx-auto mt-1 text-sm font-bold"
                    style={{
                      background: isToday ? "linear-gradient(135deg, #b497f5, #9b59d0)" : "transparent",
                      color: isToday ? "#fff" : "var(--ink)",
                      boxShadow: isToday ? "0 2px 10px #b497f566" : "none",
                    }}
                  >
                    {day.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Hour rows */}
          <div className="rounded-2xl overflow-hidden" style={{ border: "1.5px solid #e8d9f5", boxShadow: "0 4px 24px rgba(155,89,208,0.08)" }}>
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="grid grid-cols-[3.5rem_repeat(7,1fr)] border-b last:border-b-0"
                style={{ borderColor: "#e8d9f5", minHeight: "3.25rem" }}
              >
                <div
                  className="flex items-start justify-end pr-2 pt-2 text-xs font-mono shrink-0 select-none"
                  style={{ color: "#a98dc5", borderRight: "1.5px solid #e8d9f5" }}
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
                      className="relative p-1 border-l cursor-pointer group transition-colors"
                      style={{
                        borderColor: "#e8d9f5",
                        background: isToday
                          ? "rgba(180,151,245,0.10)"
                          : DAY_GRADIENTS[dow],
                      }}
                      onClick={() => setQuickAdd({ hour, days: [dow] })}
                    >
                      {/* Hover overlay */}
                      <div
                        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none"
                        style={{ background: "rgba(180,151,245,0.15)" }}
                      >
                        <span style={{ color: "#9b59d0", fontSize: "1.1rem", fontWeight: 800 }}>+</span>
                      </div>

                      {cellReminders.map((r) => (
                        <div
                          key={r.id}
                          className="rounded-lg px-1.5 py-0.5 text-xs font-bold mb-0.5 truncate relative z-10"
                          style={{
                            background: COLOR_BG[r.color] || r.color + "33",
                            color: r.color,
                            border: `1px solid ${r.color}44`,
                          }}
                          title={`${r.title} at ${fmt12(r.time)}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="opacity-60 mr-0.5 text-[10px]">:{r.time.split(":")[1]}</span>{r.title}
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
          className="w-10 h-10 rounded-2xl flex items-center justify-center text-lg font-bold"
          style={{ background: "linear-gradient(135deg, #f3e8ff, #e8d9f5)", border: "1.5px solid #e8d9f5", color: "#9b59d0", boxShadow: "0 2px 8px #b497f530" }}
        >‹</button>
        <div className="text-center">
          <p className="text-sm font-bold" style={{ color: "var(--ink)" }}>{MONTH_NAMES[month]} {year}</p>
          {data.monthOffset !== 0 && (
            <button onClick={() => onChange({ ...data, monthOffset: 0 })} className="text-xs font-semibold mt-0.5" style={{ color: "#9b59d0" }}>
              Back to today
            </button>
          )}
        </div>
        <button
          onClick={() => onChange({ ...data, monthOffset: data.monthOffset + 1 })}
          className="w-10 h-10 rounded-2xl flex items-center justify-center text-lg font-bold"
          style={{ background: "linear-gradient(135deg, #f3e8ff, #e8d9f5)", border: "1.5px solid #e8d9f5", color: "#9b59d0", boxShadow: "0 2px 8px #b497f530" }}
        >›</button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1">
        {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d, i) => (
          <div
            key={d}
            className="text-center text-xs font-bold uppercase tracking-wider py-1.5 rounded-xl"
            style={{ color: "#9b59d0", background: i >= 5 ? "#f4a7c322" : "#b497f515" }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1.5">
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
              className="rounded-2xl p-1 flex flex-col items-center gap-0.5 transition-all min-h-[3.5rem]"
              style={{
                background: isSelected
                  ? "linear-gradient(135deg, #b497f5, #9b59d0)"
                  : isToday
                  ? "#b497f522"
                  : DAY_GRADIENTS[dow] || "#f3e8ff88",
                border: `1.5px solid ${isSelected ? "#9b59d0" : isToday ? "#b497f5" : "#e8d9f5"}`,
                boxShadow: isSelected ? "0 4px 14px #b497f566" : isToday ? "0 2px 8px #b497f533" : "none",
              }}
            >
              <span className="text-sm font-bold" style={{ color: isSelected ? "#fff" : isToday ? "#9b59d0" : "var(--ink)" }}>
                {day.getDate()}
              </span>
              {dayReminders.map((r) => (
                <div
                  key={r.id}
                  className="w-full rounded-lg text-center font-semibold"
                  style={{
                    background: isSelected ? "rgba(255,255,255,0.25)" : COLOR_BG[r.color] || r.color + "33",
                    color: isSelected ? "#fff" : r.color,
                    fontSize: "9px",
                    padding: "1px 3px",
                    border: isSelected ? "none" : `1px solid ${r.color}44`,
                  }}
                >
                  {r.title.length > 7 ? r.title.slice(0, 6) + "…" : r.title}
                </div>
              ))}
              {extra > 0 && (
                <div style={{ fontSize: "9px", color: isSelected ? "rgba(255,255,255,0.7)" : "#a98dc5", fontWeight: 700 }}>+{extra}</div>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected day detail */}
      {selectedDate && (
        <div
          className="rounded-2xl p-5"
          style={{
            background: "linear-gradient(145deg, #fdf6ff, #f3e8ff)",
            border: "1.5px solid #e8d9f5",
            boxShadow: "0 4px 20px rgba(155,89,208,0.08)",
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <p className="font-bold text-base" style={{ fontFamily: "Fraunces, serif", color: "#1e1030" }}>
              {DAY_FULL[selectedDate.getDay()]}, {MONTH_NAMES[selectedDate.getMonth()]} {selectedDate.getDate()}
            </p>
            <button
              onClick={() => setQuickAdd({ hour: 9, days: [selectedDate.getDay()] })}
              className="text-xs px-3 py-1.5 rounded-xl font-bold text-white"
              style={{ background: "linear-gradient(135deg, #b497f5, #9b59d0)", boxShadow: "0 2px 8px #b497f566" }}
            >
              + Add
            </button>
          </div>
          {selectedReminders.length === 0 ? (
            <p className="text-sm" style={{ color: "#a98dc5" }}>No reminders for {DAY_FULL[selectedDate.getDay()]}s.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {selectedReminders.map((r) => (
                <div key={r.id} className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ background: r.color, boxShadow: `0 1px 4px ${r.color}88` }} />
                  <span
                    className="font-mono text-xs px-2 py-0.5 rounded-lg font-bold"
                    style={{ background: COLOR_BG[r.color] || r.color + "22", color: r.color, border: `1px solid ${r.color}33` }}
                  >
                    {fmt12(r.time)}
                  </span>
                  <span className="flex-1 text-sm font-semibold" style={{ color: "#1e1030" }}>{r.title}</span>
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
          <h1 className="text-2xl font-bold" style={{ fontFamily: "Fraunces, serif", color: "#1e1030" }}>Reminders</h1>
          <p className="text-sm mt-0.5" style={{ color: "#a98dc5" }}>
            {data.reminders.length} total · {todayReminders.length} today
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 rounded-xl text-sm font-bold text-white"
          style={{ background: "linear-gradient(135deg, #b497f5, #9b59d0)", boxShadow: "0 2px 10px #b497f566" }}
        >
          + Add
        </button>
      </div>

      {/* Today's reminders */}
      {todayReminders.length > 0 && (
        <div
          className="rounded-2xl p-5"
          style={{
            background: "linear-gradient(135deg, #b497f518, #f4a7c318)",
            border: "1.5px solid #b497f544",
            boxShadow: "0 4px 20px rgba(180,151,245,0.12)",
          }}
        >
          <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "#9b59d0" }}>
            🌟 Today — {DAY_FULL[todayDow]}
          </p>
          <div className="flex flex-col gap-2.5">
            {todayReminders.map((r) => (
              <div key={r.id} className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full shrink-0" style={{ background: r.color, boxShadow: `0 1px 4px ${r.color}88` }} />
                <span
                  className="font-mono text-xs px-2 py-0.5 rounded-lg font-bold"
                  style={{ background: COLOR_BG[r.color] || r.color + "22", color: r.color, border: `1px solid ${r.color}33` }}
                >
                  {fmt12(r.time)}
                </span>
                <span className="flex-1 text-sm font-semibold" style={{ color: "#1e1030" }}>{r.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">🌈</div>
          <p className="font-bold text-lg mb-1" style={{ color: "#1e1030", fontFamily: "Fraunces, serif" }}>No reminders yet</p>
          <p className="text-sm mb-6" style={{ color: "#a98dc5" }}>Tap any hour slot in the Week view to add one</p>
          <button
            onClick={() => setShowModal(true)}
            className="px-6 py-3 rounded-xl text-sm font-bold text-white"
            style={{ background: "linear-gradient(135deg, #b497f5, #9b59d0)", boxShadow: "0 4px 14px #b497f566" }}
          >
            + Add Reminder
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "#a98dc5" }}>All Reminders</p>
          {sorted.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-4 px-4 py-3.5 rounded-2xl group transition-all"
              style={{
                background: COLOR_BG[r.color] || r.color + "18",
                border: `1.5px solid ${r.color}33`,
              }}
            >
              <div className="w-3 h-3 rounded-full shrink-0" style={{ background: r.color, boxShadow: `0 1px 5px ${r.color}99` }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate" style={{ color: "#1e1030" }}>{r.title}</p>
                <p className="text-xs mt-0.5 font-medium" style={{ color: r.color }}>
                  {fmt12(r.time)} · {r.days.map((d) => DAY_SHORT[d]).join(", ")}
                </p>
              </div>
              <button
                onClick={() => deleteReminder(r.id)}
                className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-opacity font-bold"
                style={{ background: r.color + "22", color: r.color }}
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

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const handleChange = useCallback((next: AppData) => {
    setData(next);
    saveData(next);
  }, []);

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
