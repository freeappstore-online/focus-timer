import { useState, useEffect, useRef, useCallback } from "react";
import { Shell } from "./components/Shell";

// ─── Types ───────────────────────────────────────────────────────────────────

type TimerMode = "focus" | "short" | "long";
type TimerState = "idle" | "running" | "paused";
type NavPage = "timer" | "tasks" | "stats";

interface Task {
  id: string;
  text: string;
  done: boolean;
  pomodoros: number;
  createdAt: number;
}

interface Session {
  id: string;
  mode: TimerMode;
  duration: number; // seconds
  completedAt: number;
}

interface AppData {
  tasks: Task[];
  sessions: Session[];
  settings: {
    focusMins: number;
    shortMins: number;
    longMins: number;
    autoBreak: boolean;
    soundOn: boolean;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "focusapp_data";

const DEFAULT_DATA: AppData = {
  tasks: [],
  sessions: [],
  settings: {
    focusMins: 25,
    shortMins: 5,
    longMins: 15,
    autoBreak: false,
    soundOn: true,
  },
};

const MODE_LABELS: Record<TimerMode, string> = {
  focus: "Focus",
  short: "Short Break",
  long: "Long Break",
};

const MODE_COLORS: Record<TimerMode, string> = {
  focus: "var(--accent)",
  short: "var(--success)",
  long: "#8b5cf6",
};

const NAV_ITEMS = [
  { id: "timer", label: "Timer", icon: "⏱️" },
  { id: "tasks", label: "Tasks", icon: "✅" },
  { id: "stats", label: "Stats", icon: "📊" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DATA;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_DATA,
      ...parsed,
      settings: { ...DEFAULT_DATA.settings, ...(parsed.settings ?? {}) },
    };
  } catch {
    return DEFAULT_DATA;
  }
}

function saveData(data: AppData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function fmt(secs: number) {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function dayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function playBeep(ctx: AudioContext) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, ctx.currentTime);
  gain.gain.setValueAtTime(0.4, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.8);
}

// ─── Timer Ring ───────────────────────────────────────────────────────────────

function TimerRing({
  progress,
  mode,
  size = 260,
}: {
  progress: number;
  mode: TimerMode;
  size?: number;
}) {
  const r = (size - 20) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * (1 - progress);
  const color = MODE_COLORS[mode];

  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--line)"
        strokeWidth={10}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={10}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={dash}
        style={{ transition: "stroke-dashoffset 0.5s ease" }}
      />
    </svg>
  );
}

// ─── Timer Page ───────────────────────────────────────────────────────────────

function TimerPage({ data, onChange }: { data: AppData; onChange: (d: AppData) => void }) {
  const [mode, setMode] = useState<TimerMode>("focus");
  const [state, setState] = useState<TimerState>("idle");
  const [secondsLeft, setSecondsLeft] = useState(data.settings.focusMins * 60);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const startSecondsRef = useRef(data.settings.focusMins * 60);

  const totalSeconds = (() => {
    if (mode === "focus") return data.settings.focusMins * 60;
    if (mode === "short") return data.settings.shortMins * 60;
    return data.settings.longMins * 60;
  })();

  // Reset timer when mode or settings change (only when idle)
  useEffect(() => {
    if (state === "idle") {
      const secs =
        mode === "focus"
          ? data.settings.focusMins * 60
          : mode === "short"
          ? data.settings.shortMins * 60
          : data.settings.longMins * 60;
      setSecondsLeft(secs);
      startSecondsRef.current = secs;
    }
  }, [mode, data.settings, state]);

  const finish = useCallback(() => {
    setState("idle");
    if (intervalRef.current) clearInterval(intervalRef.current);

    // Sound
    if (data.settings.soundOn) {
      try {
        if (!audioRef.current) audioRef.current = new AudioContext();
        playBeep(audioRef.current);
      } catch {}
    }

    // Record session
    const session: Session = {
      id: uid(),
      mode,
      duration: startSecondsRef.current,
      completedAt: Date.now(),
    };

    // Increment task pomodoro if focus
    let updatedTasks = data.tasks;
    if (mode === "focus" && activeTaskId) {
      updatedTasks = data.tasks.map((t) =>
        t.id === activeTaskId ? { ...t, pomodoros: t.pomodoros + 1 } : t
      );
    }

    const next: AppData = {
      ...data,
      tasks: updatedTasks,
      sessions: [session, ...data.sessions],
    };
    onChange(next);

    // Reset
    const resetSecs =
      mode === "focus"
        ? data.settings.focusMins * 60
        : mode === "short"
        ? data.settings.shortMins * 60
        : data.settings.longMins * 60;
    setSecondsLeft(resetSecs);
  }, [data, mode, activeTaskId, onChange]);

  useEffect(() => {
    if (state === "running") {
      intervalRef.current = setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) {
            finish();
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [state, finish]);

  // Update document title
  useEffect(() => {
    document.title = state === "running" ? `${fmt(secondsLeft)} — Focus` : "Focus";
    return () => { document.title = "Focus"; };
  }, [secondsLeft, state]);

  const handleStart = () => {
    if (state === "idle") {
      const secs =
        mode === "focus"
          ? data.settings.focusMins * 60
          : mode === "short"
          ? data.settings.shortMins * 60
          : data.settings.longMins * 60;
      startSecondsRef.current = secs;
      setSecondsLeft(secs);
    }
    setState("running");
  };

  const handlePause = () => setState("paused");

  const handleReset = () => {
    setState("idle");
    const secs =
      mode === "focus"
        ? data.settings.focusMins * 60
        : mode === "short"
        ? data.settings.shortMins * 60
        : data.settings.longMins * 60;
    setSecondsLeft(secs);
  };

  const switchMode = (m: TimerMode) => {
    if (state !== "idle") handleReset();
    setMode(m);
  };

  const progress = 1 - secondsLeft / totalSeconds;
  const color = MODE_COLORS[mode];
  const incompleteTasks = data.tasks.filter((t) => !t.done);

  return (
    <div className="flex flex-col items-center gap-8 max-w-lg mx-auto">
      {/* Mode tabs */}
      <div
        className="flex rounded-xl p-1 gap-1"
        style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
      >
        {(["focus", "short", "long"] as TimerMode[]).map((m) => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{
              background: mode === m ? color : "transparent",
              color: mode === m ? "#fff" : "var(--muted)",
            }}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {/* Timer ring */}
      <div className="relative flex items-center justify-center">
        <TimerRing progress={progress} mode={mode} size={260} />
        <div className="absolute flex flex-col items-center gap-1">
          <span
            className="text-5xl font-bold tabular-nums"
            style={{ fontFamily: "Fraunces, serif", color }}
          >
            {fmt(secondsLeft)}
          </span>
          <span className="text-sm font-medium" style={{ color: "var(--muted)" }}>
            {MODE_LABELS[mode]}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleReset}
          className="w-12 h-12 rounded-full flex items-center justify-center text-xl transition-colors"
          style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
          title="Reset"
        >
          ↺
        </button>

        {state === "running" ? (
          <button
            onClick={handlePause}
            className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold text-white transition-transform active:scale-95"
            style={{ background: color, boxShadow: `0 4px 24px ${color}55` }}
          >
            ⏸
          </button>
        ) : (
          <button
            onClick={handleStart}
            className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold text-white transition-transform active:scale-95"
            style={{ background: color, boxShadow: `0 4px 24px ${color}55` }}
          >
            {state === "paused" ? "▶" : "▶"}
          </button>
        )}

        <button
          onClick={() => {
            const next = { ...data, settings: { ...data.settings, soundOn: !data.settings.soundOn } };
            onChange(next);
          }}
          className="w-12 h-12 rounded-full flex items-center justify-center text-xl transition-colors"
          style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
          title={data.settings.soundOn ? "Mute" : "Unmute"}
        >
          {data.settings.soundOn ? "🔔" : "🔕"}
        </button>
      </div>

      {/* Active task picker */}
      {mode === "focus" && incompleteTasks.length > 0 && (
        <div className="w-full">
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
            Focusing on
          </p>
          <div className="flex flex-col gap-2">
            {incompleteTasks.slice(0, 4).map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTaskId(activeTaskId === t.id ? null : t.id)}
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-left transition-all"
                style={{
                  background: activeTaskId === t.id ? `${color}18` : "var(--panel)",
                  border: `1.5px solid ${activeTaskId === t.id ? color : "var(--line)"}`,
                  color: "var(--ink)",
                }}
              >
                <span style={{ color: activeTaskId === t.id ? color : "var(--muted)" }}>
                  {activeTaskId === t.id ? "🎯" : "○"}
                </span>
                <span className="flex-1 truncate">{t.text}</span>
                {t.pomodoros > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--line)", color: "var(--muted)" }}>
                    🍅 {t.pomodoros}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Duration settings */}
      <div
        className="w-full rounded-2xl p-5"
        style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
      >
        <p className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: "var(--muted)" }}>
          Durations (minutes)
        </p>
        <div className="grid grid-cols-3 gap-4">
          {(
            [
              { key: "focusMins", label: "Focus" },
              { key: "shortMins", label: "Short" },
              { key: "longMins", label: "Long" },
            ] as { key: keyof AppData["settings"]; label: string }[]
          ).map(({ key, label }) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="text-xs font-medium" style={{ color: "var(--muted)" }}>
                {label}
              </label>
              <input
                type="number"
                min={1}
                max={120}
                value={data.settings[key] as number}
                onChange={(e) => {
                  const val = Math.max(1, Math.min(120, parseInt(e.target.value) || 1));
                  onChange({
                    ...data,
                    settings: { ...data.settings, [key]: val },
                  });
                }}
                className="w-full px-3 py-2 rounded-lg text-sm font-bold text-center"
                style={{
                  background: "var(--paper)",
                  border: "1px solid var(--line)",
                  color: "var(--ink)",
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Tasks Page ───────────────────────────────────────────────────────────────

function TasksPage({ data, onChange }: { data: AppData; onChange: (d: AppData) => void }) {
  const [input, setInput] = useState("");

  const addTask = () => {
    const text = input.trim();
    if (!text) return;
    const task: Task = { id: uid(), text, done: false, pomodoros: 0, createdAt: Date.now() };
    onChange({ ...data, tasks: [task, ...data.tasks] });
    setInput("");
  };

  const toggleTask = (id: string) => {
    onChange({
      ...data,
      tasks: data.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    });
  };

  const deleteTask = (id: string) => {
    onChange({ ...data, tasks: data.tasks.filter((t) => t.id !== id) });
  };

  const clearDone = () => {
    onChange({ ...data, tasks: data.tasks.filter((t) => !t.done) });
  };

  const pending = data.tasks.filter((t) => !t.done);
  const done = data.tasks.filter((t) => t.done);

  return (
    <div className="max-w-lg mx-auto flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: "Fraunces, serif" }}>
          Tasks
        </h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {pending.length} remaining · {done.length} done
        </p>
      </div>

      {/* Add task */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Add a task…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTask()}
          className="flex-1 px-4 py-3 rounded-xl text-sm"
          style={{
            background: "var(--panel)",
            border: "1px solid var(--line)",
            color: "var(--ink)",
          }}
        />
        <button
          onClick={addTask}
          disabled={!input.trim()}
          className="px-5 py-3 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-40"
          style={{ background: "var(--accent)" }}
        >
          Add
        </button>
      </div>

      {/* Pending tasks */}
      {pending.length === 0 && done.length === 0 && (
        <div className="text-center py-16" style={{ color: "var(--muted)" }}>
          <div className="text-5xl mb-4">🎯</div>
          <p className="font-medium">No tasks yet</p>
          <p className="text-sm mt-1">Add something to focus on</p>
        </div>
      )}

      {pending.length > 0 && (
        <div className="flex flex-col gap-2">
          {pending.map((t) => (
            <TaskRow key={t.id} task={t} onToggle={toggleTask} onDelete={deleteTask} />
          ))}
        </div>
      )}

      {/* Done tasks */}
      {done.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Completed ({done.length})
            </p>
            <button
              onClick={clearDone}
              className="text-xs font-medium hover:underline"
              style={{ color: "var(--muted)" }}
            >
              Clear all
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {done.map((t) => (
              <TaskRow key={t.id} task={t} onToggle={toggleTask} onDelete={deleteTask} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskRow({
  task,
  onToggle,
  onDelete,
}: {
  task: Task;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl group"
      style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
    >
      <button
        onClick={() => onToggle(task.id)}
        className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors"
        style={{
          borderColor: task.done ? "var(--success)" : "var(--line-strong)",
          background: task.done ? "var(--success)" : "transparent",
        }}
      >
        {task.done && <span className="text-white text-xs">✓</span>}
      </button>
      <span
        className="flex-1 text-sm"
        style={{
          color: task.done ? "var(--muted)" : "var(--ink)",
          textDecoration: task.done ? "line-through" : "none",
        }}
      >
        {task.text}
      </span>
      {task.pomodoros > 0 && (
        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--line)", color: "var(--muted)" }}>
          🍅 {task.pomodoros}
        </span>
      )}
      <button
        onClick={() => onDelete(task.id)}
        className="opacity-0 group-hover:opacity-100 text-sm transition-opacity"
        style={{ color: "var(--muted)" }}
        title="Delete"
      >
        ✕
      </button>
    </div>
  );
}

// ─── Stats Page ───────────────────────────────────────────────────────────────

function StatsPage({ data, onChange }: { data: AppData; onChange: (d: AppData) => void }) {
  const sessions = data.sessions;
  const focusSessions = sessions.filter((s) => s.mode === "focus");
  const totalFocusMins = Math.round(focusSessions.reduce((a, s) => a + s.duration, 0) / 60);
  const totalPomodoros = focusSessions.length;

  // Today stats
  const todayKey = dayKey(Date.now());
  const todaySessions = focusSessions.filter((s) => dayKey(s.completedAt) === todayKey);
  const todayMins = Math.round(todaySessions.reduce((a, s) => a + s.duration, 0) / 60);

  // Last 7 days
  const days: { label: string; mins: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const label = i === 0 ? "Today" : d.toLocaleDateString("en", { weekday: "short" });
    const mins = Math.round(
      focusSessions
        .filter((s) => dayKey(s.completedAt) === key)
        .reduce((a, s) => a + s.duration, 0) / 60
    );
    days.push({ label, mins });
  }
  const maxMins = Math.max(...days.map((d) => d.mins), 1);

  const clearHistory = () => {
    if (confirm("Clear all session history? Tasks will be kept.")) {
      onChange({ ...data, sessions: [] });
    }
  };

  return (
    <div className="max-w-lg mx-auto flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: "Fraunces, serif" }}>
          Stats
        </h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Your focus history
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Today", value: `${todayMins}m`, sub: `${todaySessions.length} sessions` },
          { label: "All time", value: `${totalFocusMins}m`, sub: `${totalPomodoros} pomodoros` },
          { label: "Tasks done", value: data.tasks.filter((t) => t.done).length.toString(), sub: "completed" },
          { label: "Streak", value: getStreak(focusSessions).toString(), sub: "days" },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-2xl p-5"
            style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
          >
            <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--muted)" }}>
              {card.label}
            </p>
            <p className="text-3xl font-bold" style={{ fontFamily: "Fraunces, serif", color: "var(--accent)" }}>
              {card.value}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
              {card.sub}
            </p>
          </div>
        ))}
      </div>

      {/* 7-day chart */}
      <div
        className="rounded-2xl p-5"
        style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
      >
        <p className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: "var(--muted)" }}>
          Last 7 days (focus minutes)
        </p>
        <div className="flex items-end gap-2 h-28">
          {days.map((d) => (
            <div key={d.label} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs font-bold" style={{ color: "var(--accent)" }}>
                {d.mins > 0 ? d.mins : ""}
              </span>
              <div
                className="w-full rounded-t-lg transition-all"
                style={{
                  height: `${Math.max((d.mins / maxMins) * 80, d.mins > 0 ? 4 : 0)}px`,
                  background: d.label === "Today" ? "var(--accent)" : "var(--line-strong)",
                  minHeight: d.mins > 0 ? "4px" : "0",
                }}
              />
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                {d.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent sessions */}
      {sessions.length > 0 && (
        <div
          className="rounded-2xl p-5"
          style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
        >
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Recent sessions
            </p>
            <button
              onClick={clearHistory}
              className="text-xs hover:underline"
              style={{ color: "var(--muted)" }}
            >
              Clear
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {sessions.slice(0, 8).map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: MODE_COLORS[s.mode] }}
                  />
                  <span style={{ color: "var(--ink)" }}>{MODE_LABELS[s.mode]}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span style={{ color: "var(--muted)" }}>{Math.round(s.duration / 60)}m</span>
                  <span style={{ color: "var(--muted)" }}>
                    {new Date(s.completedAt).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sessions.length === 0 && (
        <div className="text-center py-16" style={{ color: "var(--muted)" }}>
          <div className="text-5xl mb-4">📊</div>
          <p className="font-medium">No sessions yet</p>
          <p className="text-sm mt-1">Complete a timer to see your stats</p>
        </div>
      )}
    </div>
  );
}

function getStreak(sessions: Session[]): number {
  if (sessions.length === 0) return 0;
  const days = new Set(sessions.map((s) => dayKey(s.completedAt)));
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (days.has(key)) streak++;
    else if (i > 0) break;
  }
  return streak;
}

// ─── App Root ─────────────────────────────────────────────────────────────────

export default function App() {
  const [data, setData] = useState<AppData>(loadData);
  const [page, setPage] = useState<NavPage>("timer");

  const handleChange = useCallback((next: AppData) => {
    setData(next);
    saveData(next);
  }, []);

  return (
    <Shell
      appName="Focus"
      navItems={NAV_ITEMS}
      activeNav={page}
      onNavChange={(id) => setPage(id as NavPage)}
    >
      {page === "timer" && <TimerPage data={data} onChange={handleChange} />}
      {page === "tasks" && <TasksPage data={data} onChange={handleChange} />}
      {page === "stats" && <StatsPage data={data} onChange={handleChange} />}
    </Shell>
  );
}
