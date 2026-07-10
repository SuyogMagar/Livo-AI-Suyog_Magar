import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { animate, createTimeline, stagger } from "animejs";
import { FileAudio, Mic, Square, Upload, Loader2, Info, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { createServerFn } from "@tanstack/react-start";

// Define response structures matching backend
export interface AnalysisResult {
  overallScore: number;
  metrics: {
    fluency: number;
    rhythm: number;
    completeness: number;
  };
  words: Array<{
    text: string;
    status: "ok" | "warn" | "bad";
  }>;
  feedback: string;
  engine?: "cloud" | "local";
}

// Define the server function that receives the audio file and consent confirmation
export const analyzeAudioFn = createServerFn({ method: "POST" })
  .validator((formData: FormData) => {
    const audio = formData.get("audio");
    const consent = formData.get("consent");
    const clientTranscript = formData.get("clientTranscript");
    if (!(audio instanceof File)) {
      throw new Error("No audio recording provided.");
    }
    if (consent !== "true") {
      throw new Error("Consent to temporarily process voice data is required under the DPDP Act.");
    }
    return { audio, consent, clientTranscript: clientTranscript?.toString() };
  })
  .handler(async ({ data }) => {
    try {
      const { audio, clientTranscript } = data;
      const arrayBuffer = await audio.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64Audio = buffer.toString("base64");

      // Dynamic import to prevent bundler trying to parse node modules on client bundle
      const { analyzeAudio } = await import("../lib/analyze");
      const result = await analyzeAudio(base64Audio, audio.type || "audio/webm", clientTranscript);
      return { success: true, data: result };
    } catch (err: any) {
      console.error("Error in server handler analyzeAudioFn:", err);
      return { success: false, error: err.message || "Failed to process audio analysis." };
    }
  });

export const Route = createFileRoute("/")({
  component: SpeechHub,
});

type WordStatus = "ok" | "warn" | "bad";

const wordColor: Record<WordStatus, string> = {
  ok: "text-good cursor-pointer hover:bg-good/10 rounded px-0.5 transition",
  warn: "text-warn cursor-pointer hover:bg-warn/10 rounded px-0.5 transition underline decoration-dashed",
  bad: "text-bad cursor-pointer hover:bg-bad/10 rounded px-0.5 transition underline decoration-wavy font-bold",
};

const wordExplanation: Record<WordStatus, string> = {
  ok: "Pronounced correctly and clearly.",
  warn: "Slightly unclear, hesitated, or minor accent variation. Keep practicing!",
  bad: "Mispronounced or unclear speech. Try to enunciate the syllables slowly.",
};

function SpeechHub() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [hasReport, setHasReport] = useState(false);
  const [score, setScore] = useState(0);
  const [consentChecked, setConsentChecked] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [report, setReport] = useState<AnalysisResult | null>(null);
  const [selectedWord, setSelectedWord] = useState<{ text: string; status: WordStatus; index: number } | null>(null);
  const [clientTranscript, setClientTranscript] = useState("");
  const [browserWarning, setBrowserWarning] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        setBrowserWarning("Speech Recognition is not supported by your browser (e.g. Firefox). Please use Google Chrome, Safari, or Microsoft Edge for live audio analysis.");
      } else if (window.location.protocol !== "https:" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
        setBrowserWarning("Browser blocks Speech Recognition on unsecured HTTP connections. Please access the application via http://localhost:8080/.");
      }
    }
  }, []);

  const timerRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const clientTranscriptRef = useRef("");
  const speechRecognitionRef = useRef<any>(null);

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

  // handle automatic timer and stop at 45s
  useEffect(() => {
    if (recording) {
      timerRef.current = window.setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= 45) {
            stopRecording();
            return 45;
          }
          return s + 1;
        });
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  async function startRecording() {
    if (!consentChecked) {
      toast.warning("Please consent to the privacy guidelines first.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      setClientTranscript("");
      clientTranscriptRef.current = "";

      // Initialize Web Speech API Speech Recognition
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";
        
        let finalTranscript = "";
        recognition.onresult = (event: any) => {
          let interimTranscript = "";
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript + " ";
            } else {
              interimTranscript += event.results[i][0].transcript;
            }
          }
          const fullText = (finalTranscript + interimTranscript).trim();
          setClientTranscript(fullText);
          clientTranscriptRef.current = fullText;
        };
        
        recognition.onerror = (event: any) => {
          console.error("Speech recognition error:", event.error);
        };
        
        speechRecognitionRef.current = recognition;
        recognition.start();
      }

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const mimeType = mediaRecorder.mimeType || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const file = new File([blob], "recording.webm", { type: mimeType });
        triggerAnalysis(file, clientTranscriptRef.current);
      };

      setHasReport(false);
      setReport(null);
      setSelectedWord(null);
      setSeconds(0);
      setRecording(true);
      mediaRecorder.start();
      toast.info("Recording started. Please speak clearly in English.");
    } catch (err) {
      console.error("Microphone access error:", err);
      toast.error("Could not access microphone. Please check permissions.");
    }
  }

  function stopRecording() {
    if (!recording) return;

    if (seconds < 10) {
      toast.error(`Audio must be at least 10 seconds. Current duration: ${seconds}s.`);
      return;
    }

    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
      } catch (e) {
        console.error("Failed to stop speech recognition:", e);
      }
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      // stop tracks to release hardware
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
    }

    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!consentChecked) {
      toast.warning("Please consent to the privacy guidelines first.");
      e.target.value = "";
      return;
    }

    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side duration validation
    const audioUrl = URL.createObjectURL(file);
    const audio = new Audio(audioUrl);
    const toastId = toast.loading("Verifying file duration...");

    audio.addEventListener("loadedmetadata", () => {
      const duration = audio.duration;
      URL.revokeObjectURL(audioUrl);

      if (duration < 10 || duration > 45) {
        toast.dismiss(toastId);
        toast.error(`Invalid duration: ${Math.round(duration)}s. Audio must be between 10 and 45 seconds.`);
        e.target.value = "";
      } else {
        toast.dismiss(toastId);
        toast.success("File verified! Starting analysis...");
        setSelectedWord(null);
        triggerAnalysis(file);
      }
    });

    audio.addEventListener("error", () => {
      URL.revokeObjectURL(audioUrl);
      toast.dismiss(toastId);
      toast.error("Failed to parse audio metadata. Ensure the file is a valid audio format.");
      e.target.value = "";
    });
  }

  async function triggerAnalysis(file: File, transcript?: string) {
    setAnalyzing(true);
    setHasReport(false);

    try {
      const formData = new FormData();
      formData.append("audio", file);
      formData.append("consent", "true");
      if (transcript) {
        formData.append("clientTranscript", transcript);
      }

      const result = await analyzeAudioFn({ data: formData });

      if (!result.success) {
        throw new Error(result.error || "Failed to analyze speech.");
      }

      const reportData = result.data!;
      setReport(reportData);
      setScore(reportData.overallScore);
      setHasReport(true);

      // Trigger animations
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
            v: reportData.overallScore,
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
      toast.success("Analysis complete!");
    } catch (err: any) {
      console.error("Analysis API failed:", err);
      if (err.message?.includes("GEMINI_API_KEY")) {
        toast.error("Server Configuration Error: Gemini API key is missing on the server. Please add GEMINI_API_KEY to your env variables.");
      } else if (err.message?.includes("Speech transcript is required")) {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
          toast.error("Speech Recognition is not supported by your browser (e.g. Firefox). Please use Google Chrome, Safari, or Microsoft Edge, or add GEMINI_API_KEY to your env variables.");
        } else if (window.location.protocol !== "https:" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
          toast.error("Speech Recognition is blocked by browser security on unsecured HTTP connections. Please access the application via http://localhost:8080/ instead.");
        } else {
          toast.error("No speech transcript was captured. Please ensure microphone permissions are granted and speak clearly for at least 10 seconds.");
        }
      } else {
        toast.error(err.message || "Failed to analyze speech. Please try again.");
      }
    } finally {
      setAnalyzing(false);
    }
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
              <div className="font-display text-base font-semibold tracking-wider">LIVO AI</div>
              <div className="font-mono text-[11px] text-muted-foreground uppercase tracking-widest">Pronunciation Studio</div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-panel-border bg-panel px-3 py-1 font-mono text-[11px] text-muted-foreground">
            <span className={`h-1.5 w-1.5 rounded-full ${recording ? "bg-bad animate-pulse" : analyzing ? "bg-accent-1 animate-spin" : "bg-good"}`} />
            {recording ? "Recording..." : analyzing ? "Analyzing..." : "Ready"}
          </div>
        </header>

        {/* Top: two panels */}
        <div className="grid gap-5 md:grid-cols-2">
          {/* Recorder */}
          <section className="panel enter flex flex-col items-center justify-center gap-5 p-8">
            <div className="w-full text-left">
              <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">01 · Input</div>
              <h2 className="mt-1 text-xl font-semibold">Record or upload audio</h2>
            </div>

            <button
              ref={orbRef}
              disabled={analyzing}
              onClick={recording ? stopRecording : startRecording}
              className={`relative grid h-32 w-32 place-items-center rounded-full transition-all ${
                analyzing ? "opacity-50 cursor-not-allowed" : ""
              } ${
                recording
                  ? "bg-gradient-to-br from-bad/30 to-bad/10 text-bad glow-primary"
                  : "bg-gradient-to-br from-accent-1/25 to-accent-2/10 text-foreground hover:from-accent-1/35"
              }`}
            >
              <div className={`absolute inset-0 rounded-full border ${recording ? "border-bad/50 animate-ping" : "border-panel-border"}`} />
              {recording ? <Square className="h-9 w-9 fill-current" /> : <Mic className="h-10 w-10" />}
            </button>

            <div className="font-mono text-sm">
              <span className={recording ? "text-bad" : "text-muted-foreground"}>
                {String(Math.floor(seconds / 60)).padStart(2, "0")}:
                {String(seconds % 60).padStart(2, "0")}
              </span>
              <span className="text-muted-foreground"> / 00:45</span>
            </div>

            <div className="flex items-start gap-2.5 rounded-lg border border-panel-border bg-background/25 p-3 w-full">
              <input
                id="consent"
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-panel-border bg-panel text-accent-1 focus:ring-accent-1 cursor-pointer"
              />
              <label htmlFor="consent" className="text-[10px] leading-snug text-muted-foreground cursor-pointer select-none">
                I consent to the temporary processing of my voice audio for pronunciation feedback. 
                Data is processed strictly in-memory and deleted immediately (DPDP Act 2023 compliant).
              </label>
            </div>

            {browserWarning && (
              <div className="flex gap-2.5 rounded-lg border border-bad/30 bg-bad/5 p-3 text-xs w-full text-bad">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="leading-snug">{browserWarning}</div>
              </div>
            )}

            <div className="h-px w-full bg-panel-border" />

            <label className={`group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-dashed border-panel-border bg-background/40 p-3 transition hover:border-accent-1/60 ${analyzing ? "pointer-events-none opacity-50" : ""}`}>
              <div className="grid h-9 w-9 place-items-center rounded-md bg-panel text-accent-1">
                <Upload className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <div className="text-sm">Drop or click to upload</div>
                <div className="font-mono text-[11px] text-muted-foreground">.wav .mp3 .m4a .webm · 10–45s</div>
              </div>
              <input 
                type="file" 
                accept="audio/*" 
                className="hidden" 
                onChange={handleFileUpload} 
                disabled={analyzing} 
              />
            </label>
          </section>

          {/* Transcript */}
          <section className="panel enter flex flex-col gap-4 p-8">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">02 · Transcript</div>
              <h2 className="mt-1 text-xl font-semibold">Assessment transcription</h2>
            </div>

            <div ref={wordsRef} className="flex-1 rounded-lg border border-panel-border bg-background/40 p-5 overflow-y-auto max-h-[220px] min-h-[180px]">
              {analyzing ? (
                <div className="flex h-full min-h-[140px] flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin text-accent-1" />
                  <div className="text-sm font-mono animate-pulse">Gemini listening carefully...</div>
                </div>
              ) : hasReport && report ? (
                <p className="font-display text-lg leading-relaxed select-none">
                  {report.words.map((w, i) => (
                    <span key={i}>
                      {i > 0 && " "}
                      <span 
                        onClick={() => setSelectedWord({ text: w.text, status: w.status, index: i })}
                        className={`word inline-block ${wordColor[w.status]}`}
                      >
                        {w.text}
                      </span>
                    </span>
                  ))}
                </p>
              ) : (
                <div className="flex h-full min-h-[140px] flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                  <FileAudio className="h-6 w-6 opacity-60" />
                  <div className="text-sm">Transcript will appear after analysis</div>
                </div>
              )}
            </div>

            {selectedWord && (
              <div className="flex gap-2 rounded-lg border border-accent-1/30 bg-accent-1/5 p-3 text-xs animate-[fadeIn_0.2s_ease-out]">
                <Info className="h-4 w-4 text-accent-1 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-accent-1">"{selectedWord.text}"</span>: {wordExplanation[selectedWord.status]}
                </div>
              </div>
            )}

            <div className="flex items-center gap-4 font-mono text-[11px] text-muted-foreground border-t border-panel-border/30 pt-2">
              <Legend color="bg-good" label="Correct" />
              <Legend color="bg-warn" label="Unclear" />
              <Legend color="bg-bad" label="Error" />
            </div>
          </section>
        </div>

        {/* Report */}
        <section
          ref={reportRef}
          className={`panel p-8 transition-opacity ${hasReport ? "" : "opacity-60"}`}
        >
          <div className="mb-6 flex items-end justify-between border-b border-panel-border/30 pb-4">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">03 · Report</div>
              <div className="mt-1 flex items-center gap-2">
                <h2 className="text-xl font-semibold">Pronunciation analysis</h2>
                {hasReport && report && (
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                    report.engine === "local" 
                      ? "bg-accent-2/10 text-accent-2 border-accent-2/30 animate-pulse" 
                      : "bg-good/10 text-good border-good/30"
                  }`}>
                    {report.engine === "local" ? "Acoustic Engine (Local)" : "Cloud AI"}
                  </span>
                )}
              </div>
            </div>
            {hasReport && (
              <div className="font-mono text-[11px] text-muted-foreground">Session #LIVO-{score}X</div>
            )}
          </div>

          {analyzing ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="h-10 w-10 animate-spin text-accent-1" />
              <div className="text-sm font-mono text-muted-foreground">Generating acoustic breakdown...</div>
            </div>
          ) : hasReport && report ? (
            <div className="grid gap-8 md:grid-cols-[220px_minmax(0,1fr)]">
              <div className="flex flex-col items-center justify-center">
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
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">Accuracy</div>
                  </div>
                </div>
              </div>

              <div className="space-y-6 flex flex-col justify-between">
                <div ref={barsRef} className="space-y-4">
                  <Metric label="Fluency" value={report.metrics.fluency} />
                  <Metric label="Rhythm" value={report.metrics.rhythm} />
                  <Metric label="Completeness" value={report.metrics.completeness} />
                </div>
                <div className="rounded-lg border border-panel-border bg-background/30 p-4">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-accent-1 mb-1">
                    {report.engine === "local" ? "Acoustic Engine Feedback" : "Coach Feedback"}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{report.feedback}</p>
                  {report.engine === "local" && (
                    <div className="mt-2 text-[10px] text-muted-foreground/80 flex items-center gap-1">
                      <Info className="h-3.5 w-3.5 shrink-0 text-accent-2" />
                      <span>Local mode active due to high cloud traffic. Real-time transcription used.</span>
                    </div>
                  )}
                </div>
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
