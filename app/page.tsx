"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User } from "firebase/auth";
import { getFirestore, collection, addDoc, deleteDoc, doc, query, where, onSnapshot, setDoc, writeBatch } from "firebase/firestore";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";

// ── FIREBASE ──────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);

// ── TYPES ─────────────────────────────────────────────────────────────────────
type V2Task = { id: string; title: string; userId: string; order: number; createdAt: number; };
type Completion = { taskId: string; userId: string; date: string; month: string; isCompleted: boolean; };

// ── HELPERS ───────────────────────────────────────────────────────────────────
function getDaysInMonth(year: number, month: number): string[] {
  const days: string[] = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    d.setDate(d.getDate() + 1);
  }
  return days;
}
function toMonthKey(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}
function formatMonthYear(year: number, month: number) {
  return new Date(year, month, 1).toLocaleString("default", { month: "long", year: "numeric" });
}
function todayDateStr() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}
// Walk a date string back/forward by N days
function offsetDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── SVG PROGRESS RING ─────────────────────────────────────────────────────────
function ProgressRing({ pct, size = 120, stroke = 8, isDark }: { pct: number; size?: number; stroke?: number; isDark: boolean }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const color = pct >= 80 ? "#34C759" : pct >= 50 ? "#FF9F0A" : pct > 0 ? "#FF453A" : "#FF5C2B";
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.4,0,0.2,1), stroke 0.4s" }}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
        style={{ transform: "rotate(90deg)", transformOrigin: "center", fontSize: 22, fontWeight: 700, fill: color, transition: "fill 0.4s" }}>
        {pct}%
      </text>
    </svg>
  );
}

// ── COMPONENT ─────────────────────────────────────────────────────────────────
export default function TaskIOv2() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(true);
  const [quote, setQuote] = useState({ text: "Loading inspiration...", author: "System" });

  const [tasks, setTasks] = useState<V2Task[]>([]);
  const [completions, setCompletions] = useState<Completion[]>([]);

  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  const [isAddingTask, setIsAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const taskInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Today panel state — open by default
  const [todayPanelOpen, setTodayPanelOpen] = useState(true);

  const TODAY = useMemo(() => todayDateStr(), []);
  const monthKey = useMemo(() => toMonthKey(viewYear, viewMonth), [viewYear, viewMonth]);
  const daysInMonth = useMemo(() => getDaysInMonth(viewYear, viewMonth), [viewYear, viewMonth]);

  // ── AUTH + FIRESTORE ──────────────────────────────────────────────────────
  useEffect(() => {
    setMounted(true);
    const unsubAuth = onAuthStateChanged(auth, (cu) => {
      setUser(cu);
      setAuthLoading(false);
      if (cu) {
        const unsubTasks = onSnapshot(
          query(collection(db, "v2_tasks"), where("userId", "==", cu.uid)),
          (snap) => setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() } as V2Task)).sort((a, b) => a.order - b.order))
        );
        const unsubComp = onSnapshot(
          query(collection(db, "v2_completions"), where("userId", "==", cu.uid)),
          (snap) => setCompletions(snap.docs.map(d => d.data() as Completion))
        );
        return () => { unsubTasks(); unsubComp(); };
      } else { setTasks([]); setCompletions([]); }
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const savedTheme = localStorage.getItem("taskio-v2-theme");
    if (savedTheme === "light") setIsDark(false);
    const fetchQuote = async () => {
      const today = new Date().toDateString();
      const saved = localStorage.getItem("daily-quote");
      const savedDate = localStorage.getItem("daily-quote-date");
      if (saved && savedDate === today) { setQuote(JSON.parse(saved)); return; }
      try {
        const res = await fetch("https://dummyjson.com/quotes/random");
        const data = await res.json();
        const q = { text: data.quote, author: data.author };
        setQuote(q);
        localStorage.setItem("daily-quote", JSON.stringify(q));
        localStorage.setItem("daily-quote-date", today);
      } catch { setQuote({ text: "We are what we repeatedly do.", author: "Aristotle" }); }
    };
    fetchQuote();
  }, [mounted]);

  useEffect(() => {
    if (mounted) localStorage.setItem("taskio-v2-theme", isDark ? "dark" : "light");
  }, [isDark, mounted]);

  // ── COMPLETION CORE ───────────────────────────────────────────────────────
  const isCompleted = useCallback((taskId: string, date: string): boolean => {
    return completions.find(c => c.taskId === taskId && c.date === date)?.isCompleted ?? false;
  }, [completions]);

  const toggleCompletion = useCallback(async (taskId: string, date: string) => {
    if (!user || date > TODAY) return;
    const month = date.slice(0, 7);
    const docId = `${user.uid}_${taskId}_${date}`;
    const existing = completions.find(c => c.taskId === taskId && c.date === date);
    await setDoc(doc(db, "v2_completions", docId), {
      taskId, userId: user.uid, date, month,
      isCompleted: !(existing?.isCompleted ?? false),
    });
  }, [user, completions, TODAY]);

  // ── FEATURE 1: STREAK CALCULATOR ─────────────────────────────────────────
  // Builds a Set of completed dates per task from ALL completions (not just current month)
  const completedDatesPerTask = useMemo(() => {
    const map = new Map<string, Set<string>>();
    completions.forEach(c => {
      if (c.isCompleted) {
        if (!map.has(c.taskId)) map.set(c.taskId, new Set());
        map.get(c.taskId)!.add(c.date);
      }
    });
    return map;
  }, [completions]);

  const getStreak = useCallback((taskId: string): { current: number; best: number } => {
    const doneSet = completedDatesPerTask.get(taskId) ?? new Set<string>();
    if (doneSet.size === 0) return { current: 0, best: 0 };

    // ── Current streak: count backwards from today ──
    let current = 0;
    let cursor = TODAY;
    while (doneSet.has(cursor)) {
      current++;
      cursor = offsetDate(cursor, -1);
    }
    // If today not yet ticked, the streak is still alive from yesterday
    if (current === 0) {
      cursor = offsetDate(TODAY, -1);
      while (doneSet.has(cursor)) {
        current++;
        cursor = offsetDate(cursor, -1);
      }
    }

    // ── Best streak: scan all completed dates chronologically ──
    const sorted = Array.from(doneSet).sort();
    let best = 0;
    let run = 1;
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (offsetDate(prev, 1) === curr) {
        run++;
      } else {
        best = Math.max(best, run);
        run = 1;
      }
    }
    best = Math.max(best, run);

    return { current, best };
  }, [completedDatesPerTask, TODAY]);

  // ── DAY SCORE ─────────────────────────────────────────────────────────────
  const getDayScore = useCallback((date: string): number => {
    if (tasks.length === 0) return 0;
    return Math.round((tasks.filter(t => isCompleted(t.id, date)).length / tasks.length) * 100);
  }, [tasks, isCompleted]);

  // ── CHART + STATS ─────────────────────────────────────────────────────────
  const chartData = useMemo(() => daysInMonth.map(date => ({
    day: parseInt(date.split("-")[2]),
    score: date <= TODAY ? getDayScore(date) : null,
    isToday: date === TODAY,
  })), [daysInMonth, getDayScore, TODAY]);

  const monthStats = useMemo(() => {
    const past = daysInMonth.filter(d => d <= TODAY);
    if (past.length === 0) return { avg: 0, perfect: 0, tracked: 0 };
    const scores = past.map(d => getDayScore(d));
    return {
      avg: Math.round(scores.reduce((s, v) => s + v, 0) / scores.length),
      perfect: scores.filter(s => s === 100).length,
      tracked: past.length,
    };
  }, [daysInMonth, getDayScore, TODAY]);

  // ── ACTIONS ───────────────────────────────────────────────────────────────
  const addTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim() || !user) return;
    await addDoc(collection(db, "v2_tasks"), {
      title: newTaskTitle.trim(), userId: user.uid,
      order: tasks.length, createdAt: Date.now(),
    });
    setNewTaskTitle("");
    setTimeout(() => taskInputRef.current?.focus(), 50);
  };

  const deleteTask = async (taskId: string) => {
    if (!confirm("Delete this task and all its history?")) return;
    await deleteDoc(doc(db, "v2_tasks", taskId));
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination || result.destination.index === result.source.index) return;
    const reordered = Array.from(tasks);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    setTasks(reordered);
    const batch = writeBatch(db);
    reordered.forEach((task, index) => batch.update(doc(db, "v2_tasks", task.id), { order: index }));
    await batch.commit();
  };

  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); } else setViewMonth(m => m + 1); };

  // ── CSV ───────────────────────────────────────────────────────────────────
  const downloadTemplate = () => {
    const csv = `"title"\n"Data Type: String (task name)"\n"Example: Morning workout"\n"Example: Read 10 pages"\n"Example: No social media"\n`;
    const link = document.createElement("a");
    link.setAttribute("href", URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" })));
    link.setAttribute("download", "TaskIO_v2_Template.csv");
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const rows = text.split("\n").map(r => r.trim()).filter(r => r.length > 0);
        const headers = rows[0].split(",").map(h => h.replace(/^"|"$/g, "").trim().toLowerCase());
        const ti = headers.indexOf("title");
        if (ti === -1) { alert("CSV Error: Must have a 'title' column."); setIsImporting(false); return; }
        const batch = writeBatch(db);
        let count = 0;
        for (let i = 1; i < rows.length; i++) {
          if (rows[i].includes("Data Type") || rows[i].includes("Example")) continue;
          const cols = rows[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g, "").trim());
          const title = cols[ti];
          if (title) {
            batch.set(doc(collection(db, "v2_tasks")), { title, userId: user.uid, order: tasks.length + count, createdAt: Date.now() });
            count++;
          }
        }
        if (count > 0) { await batch.commit(); alert(`✅ Imported ${count} tasks.`); }
        else alert("⚠️ No valid tasks found.");
      } catch { alert("❌ Failed to parse CSV."); }
      finally { setIsImporting(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
    };
    reader.readAsText(file);
  };

  const exportData = () => {
    const pastDays = daysInMonth.filter(d => d <= TODAY);
    const headers = ["Task", "🔥 Streak", "Best Streak", ...pastDays.map(d => `Day ${parseInt(d.split("-")[2])}`), "% Done"];
    const rows = tasks.map(task => {
      const doneDays = pastDays.filter(d => isCompleted(task.id, d)).length;
      const pct = pastDays.length === 0 ? 0 : Math.round((doneDays / pastDays.length) * 100);
      const { current, best } = getStreak(task.id);
      return [task.title, `${current}`, `${best}`, ...pastDays.map(d => isCompleted(task.id, d) ? "1" : "0"), `${pct}%`];
    });
    const footer = ["Daily Score", "", "", ...pastDays.map(d => `${getDayScore(d)}%`), `${monthStats.avg}% avg`];
    const csv = [headers, ...rows, footer].map(row => row.map(c => `"${c}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" })));
    link.setAttribute("download", `TaskIO_${monthKey}_export.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  if (!mounted) return null;

  // ── STYLES ────────────────────────────────────────────────────────────────
  const G = "font-[family-name:var(--font-geist-sans)]";
  const TW = isDark ? "bg-[#0A0A0A] text-[#F5F5F5]" : "bg-[#F5F5F5] text-[#1A1A1A]";
  const card = `rounded-[14px] ${isDark ? "bg-[#111111] border border-white/[0.08]" : "bg-white border border-black/[0.08] shadow-sm"}`;
  const inp = `w-full px-4 py-2.5 rounded-[10px] focus:outline-none transition-colors border text-[14px] ${isDark ? "bg-white/[0.04] border-white/[0.08] text-[#F5F5F5] placeholder-[#A0A0A0] focus:border-[#FF5C2B]" : "bg-black/[0.04] border-black/[0.08] text-[#1A1A1A] placeholder-[#6B6B6B] focus:border-[#FF5C2B]"}`;
  const btnP = `bg-[#FF5C2B] hover:bg-[#FF8A5C] text-white rounded-full px-5 py-2 text-[13px] font-semibold transition-colors border-none whitespace-nowrap ${G}`;
  const btnS = `rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors border ${G} ${isDark ? "border-[#FF5C2B]/60 text-[#FF5C2B] hover:bg-[#FF5C2B]/10" : "border-[#FF5C2B] text-[#FF5C2B] hover:bg-[#FF5C2B]/10"}`;
  const btnG = `text-[13px] font-medium transition-opacity hover:opacity-70 ${G} ${isDark ? "text-[#A0A0A0]" : "text-[#6B6B6B]"}`;
  const muted = isDark ? "text-[#A0A0A0]" : "text-[#6B6B6B]";
  const cb = isDark ? "border-white/[0.06]" : "border-black/[0.06]";
  const stickyBg = isDark ? "bg-[#111111]" : "bg-white";
  const footerBg = isDark ? "bg-[#0D0D0D]" : "bg-[#F0F0F0]";
  const scoreColor = (s: number) => s >= 80 ? "text-[#34C759]" : s >= 50 ? "text-[#FF9F0A]" : s > 0 ? "text-[#FF453A]" : muted;

  if (authLoading) return (
    <div className={`min-h-screen flex items-center justify-center ${TW} ${G}`}>
      <p className={`text-[14px] ${muted}`}>Checking credentials…</p>
    </div>
  );

  if (!user) return (
    <div className={`min-h-screen flex items-center justify-center ${TW} ${G}`}>
      <div className={`${card} p-8 w-full max-w-sm flex flex-col gap-6 text-center`}>
        <div>
          <h1 className="text-[30px] font-bold tracking-tight">Task.IO</h1>
          <p className={`text-[12px] mt-1 ${muted}`}>v2 · Daily Consistency Tracker</p>
        </div>
        <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className={`${btnP} w-full py-3 text-[15px]`}>
          Continue with Google
        </button>
      </div>
    </div>
  );

  const firstName = user.displayName?.split(" ")[0] ?? "there";
  const todayScore = getDayScore(TODAY);
  const todayLabel = new Date().toLocaleDateString("default", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className={`min-h-screen ${TW} ${G}`}>
      <div className="max-w-[1500px] mx-auto px-4 py-6 flex flex-col gap-5">

        {/* HEADER */}
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[22px] font-bold tracking-tight">Task.IO</h1>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${isDark ? "bg-[#FF5C2B]/20 text-[#FF5C2B]" : "bg-[#FF5C2B]/10 text-[#FF5C2B]"}`}>v2</span>
            </div>
            <p className={`text-[12px] mt-0.5 ${muted}`}>Hey {firstName} 👋 — {formatMonthYear(viewYear, viewMonth)}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setIsDark(!isDark)} className={btnS}>{isDark ? "Light" : "Dark"}</button>
            <button onClick={() => signOut(auth)} className={btnG}>Log out</button>
          </div>
        </header>

        {/* QUOTE */}
        <p className={`text-[12px] italic ${muted}`}>"{quote.text}" — {quote.author}</p>

        {/* ── FEATURE 2: TODAY'S FOCUS PANEL ── */}
        {tasks.length > 0 && (
          <div className={`${card} overflow-hidden transition-all duration-300`}>
            {/* Panel header — always visible, click to collapse */}
            <button
              onClick={() => setTodayPanelOpen(v => !v)}
              className="w-full flex items-center justify-between px-5 py-4 hover:opacity-80 transition-opacity"
            >
              <div className="flex items-center gap-3">
                <span className="text-[16px] font-bold">🎯 Today's Focus</span>
                <span className={`text-[12px] ${muted}`}>{todayLabel}</span>
                {/* Live score badge */}
                <span className={`text-[12px] font-bold px-2.5 py-0.5 rounded-full ${
                  todayScore === 100 ? "bg-[#34C759]/15 text-[#34C759]" :
                  todayScore >= 50  ? "bg-[#FF9F0A]/15 text-[#FF9F0A]" :
                  todayScore > 0    ? "bg-[#FF453A]/15 text-[#FF453A]" :
                                      isDark ? "bg-white/[0.06] text-[#A0A0A0]" : "bg-black/[0.06] text-[#6B6B6B]"
                }`}>
                  {todayScore === 100 ? "🏆 Perfect!" : `${todayScore}% done`}
                </span>
              </div>
              <span className={`text-[13px] ${muted}`}>{todayPanelOpen ? "▲" : "▼"}</span>
            </button>

            {/* Collapsible body */}
            {todayPanelOpen && (
              <div className={`border-t ${isDark ? "border-white/[0.06]" : "border-black/[0.06]"} px-5 py-5`}>
                <div className="flex gap-6 items-start flex-wrap md:flex-nowrap">

                  {/* Task checklist — large, tappable */}
                  <div className="flex-1 flex flex-col gap-2 min-w-0">
                    {tasks.map(task => {
                      const done = isCompleted(task.id, TODAY);
                      const { current: streak } = getStreak(task.id);
                      return (
                        <button
                          key={task.id}
                          onClick={() => toggleCompletion(task.id, TODAY)}
                          className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-[12px] border text-left transition-all active:scale-[0.98] ${
                            done
                              ? isDark ? "bg-[#34C759]/10 border-[#34C759]/20" : "bg-[#34C759]/10 border-[#34C759]/20"
                              : isDark ? "bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06]" : "bg-black/[0.02] border-black/[0.06] hover:bg-black/[0.04]"
                          }`}
                        >
                          {/* Custom large checkbox */}
                          <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                            done ? "bg-[#34C759] border-[#34C759]" : isDark ? "border-white/20" : "border-black/20"
                          }`}>
                            {done && (
                              <svg width="12" height="9" viewBox="0 0 12 9" fill="none">
                                <path d="M1 4L4.5 7.5L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </div>
                          {/* Task title */}
                          <span className={`text-[15px] font-medium flex-1 transition-all ${done ? `line-through ${muted} opacity-60` : ""}`}>
                            {task.title}
                          </span>
                          {/* Streak badge */}
                          {streak > 0 && (
                            <span className={`text-[12px] font-semibold shrink-0 px-2 py-0.5 rounded-full ${
                              isDark ? "bg-[#FF5C2B]/20 text-[#FF5C2B]" : "bg-[#FF5C2B]/15 text-[#FF5C2B]"
                            }`}>
                              🔥 {streak}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Progress Ring — right side */}
                  <div className="flex flex-col items-center gap-2 shrink-0 mx-auto md:mx-0">
                    <ProgressRing pct={todayScore} size={130} stroke={10} isDark={isDark} />
                    <p className={`text-[11px] font-semibold text-center ${muted}`}>
                      {tasks.filter(t => isCompleted(t.id, TODAY)).length}/{tasks.length} tasks
                    </p>
                    {todayScore === 100 && (
                      <p className="text-[12px] font-bold text-[#34C759] animate-pulse">Perfect day! 🏆</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* CONTROLS */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className={`flex items-center gap-1 rounded-full px-3 py-1.5 border ${isDark ? "border-white/[0.08] bg-white/[0.03]" : "border-black/[0.08] bg-black/[0.02]"}`}>
            <button onClick={prevMonth} className={`px-2 py-1 text-[13px] hover:opacity-70 ${muted}`}>◀</button>
            <span className="text-[13px] font-semibold min-w-[130px] text-center">{formatMonthYear(viewYear, viewMonth)}</span>
            <button onClick={nextMonth} className={`px-2 py-1 text-[13px] hover:opacity-70 ${muted}`}>▶</button>
          </div>
          <button onClick={() => { setIsAddingTask(true); setTimeout(() => taskInputRef.current?.focus(), 50); }} className={btnP}>+ Add Task</button>
          <button onClick={downloadTemplate} className={btnS}>📋 Template</button>
          <input type="file" accept=".csv" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
          <button onClick={() => fileInputRef.current?.click()} disabled={isImporting} className={btnS}>
            {isImporting ? "Importing…" : "📥 Import CSV"}
          </button>
          {tasks.length > 0 && <button onClick={exportData} className={btnS}>📤 Export</button>}
        </div>

        {/* ADD TASK FORM */}
        {isAddingTask && (
          <form onSubmit={addTask} className={`flex gap-3 items-center p-4 rounded-[12px] border ${isDark ? "bg-white/[0.02] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"}`}>
            <input ref={taskInputRef} type="text" value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)}
              placeholder="Type task and press Enter — add as many as you want…" className={`${inp} flex-1`} autoFocus />
            <button type="submit" className={btnP}>Save</button>
            <button type="button" onClick={() => { setIsAddingTask(false); setNewTaskTitle(""); }} className={btnG}>Done</button>
          </form>
        )}

        {/* EMPTY STATE */}
        {tasks.length === 0 && (
          <div className={`${card} p-14 text-center`}>
            <p className="text-[18px] font-bold mb-2">No tasks yet 🎯</p>
            <p className={`text-[14px] ${muted}`}>Click "+ Add Task" to start building your daily consistency.</p>
          </div>
        )}

        {/* ── MAIN GRID ── */}
        {tasks.length > 0 && (
          <div className={`${card} overflow-hidden`}>
            <div className="overflow-x-auto">
              <DragDropContext onDragEnd={handleDragEnd}>
                <table className="w-full border-collapse" style={{ minWidth: `${290 + daysInMonth.length * 46}px` }}>

                  {/* THEAD */}
                  <thead>
                    <tr>
                      <th className={`sticky left-0 z-20 border-b border-r ${cb} ${stickyBg}`} style={{ minWidth: 32, maxWidth: 32 }} />
                      <th className={`sticky left-8 z-20 text-left px-4 py-3 text-[11px] font-bold tracking-widest ${muted} border-b border-r ${cb} ${stickyBg}`} style={{ minWidth: 220 }}>
                        TASK · 🔥 STREAK
                      </th>
                      {daysInMonth.map(date => {
                        const dayNum = parseInt(date.split("-")[2]);
                        const isToday = date === TODAY;
                        const dow = new Date(date + "T12:00:00").toLocaleString("default", { weekday: "short" }).slice(0, 2).toUpperCase();
                        const isSat = new Date(date + "T12:00:00").getDay() === 6;
                        const isSun = new Date(date + "T12:00:00").getDay() === 0;
                        return (
                          <th key={date} className={`py-2 text-center border-b border-r ${cb} ${(isSat || isSun) ? isDark ? "bg-white/[0.015]" : "bg-black/[0.015]" : ""}`} style={{ minWidth: 46, maxWidth: 46 }}>
                            <div className="flex flex-col items-center gap-0.5 px-1">
                              <span className={`text-[9px] font-semibold ${(isSat || isSun) ? "text-[#FF5C2B]" : muted}`}>{dow}</span>
                              <span className={`text-[12px] font-bold w-6 h-6 flex items-center justify-center rounded-full ${isToday ? "bg-[#FF5C2B] text-white" : muted}`}>{dayNum}</span>
                            </div>
                          </th>
                        );
                      })}
                      <th className={`px-3 py-3 text-center text-[11px] font-bold tracking-widest ${muted} border-b border-l ${cb}`} style={{ minWidth: 64 }}>DONE</th>
                    </tr>
                  </thead>

                  {/* DROPPABLE TBODY */}
                  <Droppable droppableId="task-rows">
                    {(droppableProvided) => (
                      <tbody ref={droppableProvided.innerRef} {...droppableProvided.droppableProps}>
                        {tasks.map((task, index) => {
                          const pastDays = daysInMonth.filter(d => d <= TODAY);
                          const doneDays = pastDays.filter(d => isCompleted(task.id, d)).length;
                          const pct = pastDays.length === 0 ? 0 : Math.round((doneDays / pastDays.length) * 100);
                          // ── FEATURE 1: get streak for this task ──
                          const { current: streak, best: bestStreak } = getStreak(task.id);

                          return (
                            <Draggable key={task.id} draggableId={task.id} index={index}>
                              {(provided, snapshot) => (
                                <tr
                                  ref={provided.innerRef} {...provided.draggableProps}
                                  className={`group transition-colors ${snapshot.isDragging ? isDark ? "bg-white/[0.06]" : "bg-black/[0.04]" : isDark ? "hover:bg-white/[0.025]" : "hover:bg-black/[0.02]"}`}
                                >
                                  {/* DRAG HANDLE */}
                                  <td {...provided.dragHandleProps} className={`sticky left-0 z-10 border-b border-r ${cb} ${stickyBg} cursor-grab active:cursor-grabbing`} style={{ minWidth: 32, maxWidth: 32 }}>
                                    <div className={`flex items-center justify-center py-3 text-[14px] opacity-0 group-hover:opacity-40 transition-opacity select-none ${muted}`}>⠿</div>
                                  </td>

                                  {/* ── TASK NAME + STREAK BADGE ── */}
                                  <td className={`sticky left-8 z-10 px-4 py-2.5 border-b border-r ${cb} ${stickyBg}`}>
                                    <div className="flex items-center gap-2 justify-between">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className={`text-[14px] font-medium leading-snug truncate transition-all ${pct === 100 ? `line-through opacity-40` : ""}`}>
                                          {task.title}
                                        </span>
                                        {/* Streak pill — only show if streak > 0 */}
                                        {streak > 0 && (
                                          <span
                                            title={`Current streak: ${streak} day${streak !== 1 ? "s" : ""} · Best: ${bestStreak} day${bestStreak !== 1 ? "s" : ""}`}
                                            className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full cursor-default transition-all ${
                                              streak >= 7 ? "bg-[#FF5C2B] text-white shadow-[0_0_8px_rgba(255,92,43,0.4)]"
                                              : isDark ? "bg-[#FF5C2B]/20 text-[#FF5C2B]" : "bg-[#FF5C2B]/15 text-[#FF5C2B]"
                                            }`}
                                          >
                                            🔥 {streak}
                                          </span>
                                        )}
                                      </div>
                                      <button onClick={() => deleteTask(task.id)} className="text-[10px] font-bold text-[#FF453A] opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0">✕</button>
                                    </div>
                                    {/* Best streak sub-label — only when streak is meaningful */}
                                    {bestStreak >= 3 && (
                                      <p className={`text-[10px] mt-0.5 ${muted} opacity-60`}>Best: {bestStreak}d</p>
                                    )}
                                  </td>

                                  {/* CHECKBOXES */}
                                  {daysInMonth.map(date => {
                                    const checked = isCompleted(task.id, date);
                                    const isFuture = date > TODAY;
                                    const isToday = date === TODAY;
                                    const isSat = new Date(date + "T12:00:00").getDay() === 6;
                                    const isSun = new Date(date + "T12:00:00").getDay() === 0;
                                    return (
                                      <td key={date}
                                        className={`text-center border-b border-r ${cb}
                                          ${isToday ? isDark ? "bg-[#FF5C2B]/[0.06]" : "bg-[#FF5C2B]/[0.04]" : ""}
                                          ${(isSat || isSun) && !isToday ? isDark ? "bg-white/[0.015]" : "bg-black/[0.015]" : ""}
                                        `}
                                        style={{ minWidth: 46, maxWidth: 46 }}
                                      >
                                        <div className="flex items-center justify-center py-2.5">
                                          <input type="checkbox" checked={checked} onChange={() => toggleCompletion(task.id, date)} disabled={isFuture}
                                            className={`w-[15px] h-[15px] rounded accent-[#FF5C2B] ${isFuture ? "opacity-[0.12] cursor-not-allowed" : "cursor-pointer"}`} />
                                        </div>
                                      </td>
                                    );
                                  })}

                                  {/* ROW % */}
                                  <td className={`px-3 py-2.5 text-center border-b border-l ${cb}`}>
                                    <span className={`text-[12px] font-bold ${scoreColor(pct)}`}>{pct}%</span>
                                  </td>
                                </tr>
                              )}
                            </Draggable>
                          );
                        })}
                        {droppableProvided.placeholder}
                      </tbody>
                    )}
                  </Droppable>

                  {/* TFOOT */}
                  <tfoot>
                    <tr className={footerBg}>
                      <td className={`sticky left-0 z-10 border-t ${cb} ${footerBg}`} style={{ minWidth: 32 }} />
                      <td className={`sticky left-8 z-10 px-4 py-3 border-t border-r ${cb} ${footerBg}`}>
                        <span className={`text-[11px] font-bold tracking-widest ${muted}`}>DAILY %</span>
                      </td>
                      {daysInMonth.map(date => {
                        const score = getDayScore(date);
                        const isFuture = date > TODAY;
                        const isToday = date === TODAY;
                        return (
                          <td key={date} className={`text-center border-t ${cb} py-2 ${isToday ? isDark ? "bg-[#FF5C2B]/[0.06]" : "bg-[#FF5C2B]/[0.04]" : ""}`}>
                            {isFuture
                              ? <span className={`text-[10px] ${muted} opacity-30`}>—</span>
                              : <span className={`text-[11px] font-bold ${scoreColor(score)}`}>{score}%</span>
                            }
                          </td>
                        );
                      })}
                      <td className={`px-3 py-3 text-center border-t border-l ${cb}`}>
                        <span className={`text-[12px] font-bold ${scoreColor(monthStats.avg)}`}>{monthStats.avg}%</span>
                      </td>
                    </tr>
                  </tfoot>

                </table>
              </DragDropContext>
            </div>
          </div>
        )}

        {/* BAR CHART */}
        {tasks.length > 0 && (
          <div className={`${card} p-6`}>
            <div className="flex items-start justify-between flex-wrap gap-4 mb-5">
              <div>
                <h3 className="text-[15px] font-bold">Monthly Performance</h3>
                <p className={`text-[12px] ${muted}`}>{formatMonthYear(viewYear, viewMonth)} · daily completion score</p>
              </div>
              <div className="flex gap-5">
                {[
                  { label: "Avg Score", value: `${monthStats.avg}%`, color: scoreColor(monthStats.avg) },
                  { label: "Perfect Days", value: `${monthStats.perfect}`, color: "text-[#FF5C2B]" },
                  { label: "Days Tracked", value: `${monthStats.tracked}`, color: "" },
                ].map(s => (
                  <div key={s.label} className="text-right">
                    <p className={`text-[10px] font-semibold tracking-wide ${muted}`}>{s.label}</p>
                    <p className={`text-[22px] font-bold leading-tight ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} barSize={12} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: isDark ? "#A0A0A0" : "#6B6B6B" }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: isDark ? "#A0A0A0" : "#6B6B6B" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                <Tooltip cursor={{ fill: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" }}
                  contentStyle={{ backgroundColor: isDark ? "#1A1A1A" : "#fff", border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`, borderRadius: 10, fontSize: 12, color: isDark ? "#F5F5F5" : "#1A1A1A" }}
                  formatter={(v) => [`${v ?? 0}%`, "Score"]} labelFormatter={(l) => `Day ${l}`}
                <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, i) => {
                    const s = entry.score ?? 0;
                    const fill = entry.score === null
                      ? (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)")
                      : s >= 80 ? "#34C759" : s >= 50 ? "#FF9F0A" : s > 0 ? "#FF453A"
                      : (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)");
                    return <Cell key={i} fill={fill} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className={`flex gap-5 mt-3 text-[11px] flex-wrap ${muted}`}>
              {[{ color: "#34C759", label: "80–100% · Great" }, { color: "#FF9F0A", label: "50–79% · Decent" }, { color: "#FF453A", label: "1–49% · Needs work" }].map(l => (
                <span key={l.label} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: l.color }} />
                  {l.label}
                </span>
              ))}
            </div>
          </div>
        )}

        <p className={`text-center text-[11px] pb-4 ${muted}`}>Task.IO v2 · Built for consistency 🔥</p>
      </div>
    </div>
  );
}
