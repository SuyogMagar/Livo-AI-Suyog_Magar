import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { animate, createTimeline, stagger } from "animejs";
import { FileAudio, Mic, Square, Upload } from "lucide-react";

export const Route = createFileRoute("/")({
  component: SpeechHub,
});

type WordStatus = "ok" | "warn" | "bad";
interface Word { text: string; status: WordStatus }

const TRANSCRIPT: Word[] = [
  { text: "The", status: "ok" },
  { text: "quantum", status: "bad" },
  { text: "resonance", status: "ok" },
  { text: "cascade", status: "warn" },
  { text: "amplifies", status: "ok" },
  { text: "neural", status: "bad" },
  { text: "pathways", status: "ok" },
  { text: "across", status: "ok" },
  { text: "the", status: "ok" },
  { text: "synaptic", status: "warn" },
  { text: "grid", status: "ok" },
];

const wordColor: Record<WordStatus, string> = {
  ok: "text-good",
  warn: "text-warn",
  bad: "text-bad",
};

function SpeechHub() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [hasReport, setHasReport] = useState(false);
  const [score, setScore] = useState(0);
  const timerRef = useRef<number | null>(null);

  const scoreRef = useRef<HTMLSpanElement>(null);
  const barsRef = useRef<HTMLDivElement>(null);
  const wordsRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<HTMLButtonElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  // entry animation
  useEffect(() => {
    animate(".enter", {
      opacity: [0, 1],
      translateY: [16, 0],
      duration: 700,
      delay: stagger(90),
      ease: "outCubic",
    });
  }, []);

  // recording pulse
  useEffect(() => {
    if (!recording || !orbRef.current) return;
    const anim = animate(orbRef.current, {
      scale: [1, 1.06, 1],
      duration: 1200,
      loop: true,
      ease: "inOutSine",
    });
    return () => { anim.pause(); };
  }, [recording]);

  useEffect(() => {
    if (recording) {
      timerRef.current = window.setInterval(() => {
        setSeconds((s) => (s + 1 >= 45 ? (stop(), 45) : s + 1));
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  function start() {
    setHasReport(false);
    setSeconds(0);
    setRecording(true);
  }

  function stop() {
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    generateReport();
  }

  function generateReport() {
    const finalScore = 78 + Math.floor(Math.random() * 18);
    setScore(finalScore);
    setHasReport(true);

    // animate after mount
    requestAnimationFrame(() => {
      if (reportRef.current) {
        animate(reportRef.current, {
          opacity: [0, 1],
          translateY: [20, 0],
          duration: 600,
          ease: "outCubic",
        });
      }

      if (scoreRef.current) {
        const obj = { v: 0 };
        animate(obj, {
          v: finalScore,
          duration: 1400,
          ease: "outExpo",
          onUpdate: () => {
            if (scoreRef.current) scoreRef.current.textContent = String(Math.round(obj.v));
          },
        });
      }

      if (barsRef.current) {
        const bars = barsRef.current.querySelectorAll<HTMLElement>("[data-bar]");
        bars.forEach((el) => {
          const target = Number(el.dataset.value ?? 0);
          animate(el, {
            width: [`0%`, `${target}%`],
            duration: 1100,
            ease: "outExpo",
          });
        });
      }

      if (wordsRef.current) {
        const tl = createTimeline();
        tl.add(wordsRef.current.querySelectorAll(".word"), {
          opacity: [0, 1],
          translateY: [8, 0],
          duration: 450,
          delay: stagger(35),
          ease: "outCubic",
        });
      }
    });
  }

  return (
    <div className="min-h-screen w-full px-4 py-8 md:px-8 md:py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        {/* Header */}
        <header className="enter flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-accent-1 to-accent-2 text-primary-foreground">
              <Mic className="h-4 w-4" />
            </div>
            <div>
              <div className="font-display text-base font-semibold">LIVO AI</div>
              <div className="font-mono text-[11px] text-muted-foreground">Pronunciation Studio</div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-panel-border bg-panel px-3 py-1 font-mono text-[11px] text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-good" />
            Ready
          </div>
        </header>

        {/* Top: two panels */}
        <div className="grid gap-5 md:grid-cols-2">
          {/* Recorder */}
          <section className="panel enter flex flex-col items-center justify-center gap-6 p-8">
            <div className="w-full text-left">
              <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">01 · Input</div>
              <h2 className="mt-1 text-xl font-semibold">Record or upload audio</h2>
            </div>

            <button
              ref={orbRef}
              onClick={recording ? stop : start}
              className={`relative grid h-32 w-32 place-items-center rounded-full transition-colors ${
                recording
                  ? "bg-gradient-to-br from-bad/30 to-bad/10 text-bad glow-primary"
                  : "bg-gradient-to-br from-accent-1/25 to-accent-2/10 text-foreground hover:from-accent-1/35"
              }`}
            >
              <div className={`absolute inset-0 rounded-full border ${recording ? "border-bad/50" : "border-panel-border"}`} />
              {recording ? <Square className="h-9 w-9 fill-current" /> : <Mic className="h-10 w-10" />}
            </button>

            <div className="font-mono text-sm">
              <span className={recording ? "text-bad" : "text-muted-foreground"}>
                {String(Math.floor(seconds / 60)).padStart(2, "0")}:
                {String(seconds % 60).padStart(2, "0")}
              </span>
              <span className="text-muted-foreground"> / 00:45</span>
            </div>

            <div className="h-px w-full bg-panel-border" />

            <label className="group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-dashed border-panel-border bg-background/40 p-3 transition hover:border-accent-1/60">
              <div className="grid h-9 w-9 place-items-center rounded-md bg-panel text-accent-1">
                <Upload className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <div className="text-sm">Drop or click to upload</div>
                <div className="font-mono text-[11px] text-muted-foreground">.wav .mp3 .m4a · 30–45s</div>
              </div>
              <input type="file" accept="audio/*" className="hidden" />
            </label>
          </section>

          {/* Transcript */}
          <section className="panel enter flex flex-col gap-4 p-8">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">02 · Transcript</div>
              <h2 className="mt-1 text-xl font-semibold">Live transcription</h2>
            </div>

            <div ref={wordsRef} className="flex-1 rounded-lg border border-panel-border bg-background/40 p-5">
              {hasReport ? (
                <p className="font-display text-lg leading-relaxed">
                  {TRANSCRIPT.map((w, i) => (
                    <span key={i}>
                      {i > 0 && " "}
                      <span className={`word inline-block ${wordColor[w.status]}`}>{w.text}</span>
                    </span>
                  ))}
                </p>
              ) : (
                <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                  <FileAudio className="h-6 w-6 opacity-60" />
                  <div className="text-sm">Transcript will appear after recording</div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-4 font-mono text-[11px] text-muted-foreground">
              <Legend color="bg-good" label="Correct" />
              <Legend color="bg-warn" label="Unclear" />
              <Legend color="bg-bad" label="Error" />
            </div>
          </section>
        </div>

        {/* Report */}
        <section
          ref={reportRef}
          className={`panel p-8 ${hasReport ? "" : "opacity-60"}`}
        >
          <div className="mb-6 flex items-end justify-between">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">03 · Report</div>
              <h2 className="mt-1 text-xl font-semibold">Pronunciation analysis</h2>
            </div>
            {hasReport && (
              <div className="font-mono text-[11px] text-muted-foreground">Session #A1-07F</div>
            )}
          </div>

          {hasReport ? (
            <div className="grid gap-8 md:grid-cols-[220px_minmax(0,1fr)]">
              <div className="flex flex-col items-center">
                <div className="relative flex h-40 w-40 items-center justify-center">
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: `conic-gradient(var(--accent-1) ${score * 3.6}deg, oklch(0.28 0.02 265) 0deg)`,
                    }}
                  />
                  <div className="absolute inset-2 rounded-full bg-panel" />
                  <div className="relative text-center">
                    <div className="font-display text-4xl font-bold">
                      <span ref={scoreRef}>0</span>
                      <span className="text-xl text-muted-foreground">%</span>
                    </div>
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Accuracy</div>
                  </div>
                </div>
              </div>

              <div ref={barsRef} className="space-y-5 self-center">
                <Metric label="Fluency" value={84} />
                <Metric label="Rhythm" value={72} />
                <Metric label="Completeness" value={91} />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              Record or upload audio to generate a report
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-foreground">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-background/60">
        <div
          data-bar
          data-value={value}
          className="h-full rounded-full bg-gradient-to-r from-accent-1 to-accent-2"
          style={{ width: 0 }}
        />
      </div>
    </div>
  );
}
