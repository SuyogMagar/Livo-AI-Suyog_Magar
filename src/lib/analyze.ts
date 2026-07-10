import fs from "fs";
import path from "path";

function getEnvVar(key: string): string | undefined {
  let val: string | undefined = undefined;

  // 1. Try process.env first
  if (typeof process !== "undefined" && process.env && process.env[key]) {
    val = process.env[key];
  }

  // 2. Try import.meta.env (Vite standard)
  if (!val && typeof import.meta !== "undefined" && import.meta.env && import.meta.env[key]) {
    val = import.meta.env[key] as string;
  }

  // 3. Try globalThis
  if (!val && (globalThis as any)[key]) {
    val = (globalThis as any)[key];
  }

  // 4. Try parsing .env file directly from the root directory
  if (!val) {
    try {
      const envPath = path.resolve(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf-8");
        const lines = content.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
            const eqIdx = trimmed.indexOf("=");
            const k = trimmed.substring(0, eqIdx).trim();
            const v = trimmed.substring(eqIdx + 1).trim();
            if (k === key) {
              val = v.replace(/^['"]|['"]$/g, "");
              break;
            }
          }
        }
      }
    } catch (err) {
      // Ignore
    }
  }

  console.log(`[Env Debug] Checking key: ${key} -> Found: ${val ? "YES (starts with " + val.substring(0, 5) + "...)" : "NO"}`);
  return val;
}

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

async function analyzeWithAlternativeLLM(clientTranscript: string): Promise<AnalysisResult> {
  const groqKey = getEnvVar("GROQ_API_KEY");
  const openRouterKey = getEnvVar("OPENROUTER_API_KEY");

  if (!groqKey && !openRouterKey) {
    throw new Error("No alternative LLM key (GROQ_API_KEY or OPENROUTER_API_KEY) is configured.");
  }

  const isGroq = !!groqKey;
  const apiKey = groqKey || openRouterKey;
  const url = isGroq 
    ? "https://api.groq.com/openai/v1/chat/completions" 
    : "https://openrouter.ai/api/v1/chat/completions";

  const modelName = isGroq ? "llama-3.3-70b-versatile" : "openrouter/free";

  const prompt = `You are a professional English pronunciation coach.
Analyze the following transcript of someone speaking English:
"${clientTranscript}"

Since this is a textual transcript of audio, simulate a phonetic pronunciation analysis.
Identify likely mispronunciations, hesitations, or spelling variations.
1. Provide an overall accuracy score (0-100).
2. Rate metrics: fluency (0-100), rhythm (0-100), and completeness (0-100).
3. Output the exact word-by-word list in order. For each word in the transcript, classify its status as:
   - "ok": correct pronunciation.
   - "warn": minor hesitation, stutter, or slightly unclear pronunciation.
   - "bad": mispronounced, skipped, or garbled.
4. Provide a short, constructive paragraph of feedback to help the speaker improve.

Respond strictly with a JSON object matching this schema:
{
  "overallScore": number,
  "metrics": {
    "fluency": number,
    "rhythm": number,
    "completeness": number
  },
  "words": [
    { "text": string, "status": "ok" | "warn" | "bad" }
  ],
  "feedback": string
}`;

  console.log(`[Alternative AI] Attempting analysis using ${isGroq ? "Groq" : "OpenRouter"} with model: ${modelName}`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      ...(isGroq ? {} : { "HTTP-Referer": "https://livo.ai", "X-Title": "Livo AI" })
    },
    body: JSON.stringify({
      model: modelName,
      messages: [{ role: "user", content: prompt }],
      ...(isGroq ? { response_format: { type: "json_object" } } : {}),
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`[Alternative AI] API error from ${isGroq ? "Groq" : "OpenRouter"}: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  let content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`[Alternative AI] Empty response from ${isGroq ? "Groq" : "OpenRouter"}`);
  }

  // Clean markdown code blocks from the content if present
  content = content.trim();
  if (content.startsWith("```")) {
    const match = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) {
      content = match[1];
    }
  }

  const result = JSON.parse(content) as AnalysisResult;
  result.engine = "cloud"; // Signal it's a Cloud AI analysis
  console.log(`[Alternative AI] Successfully completed analysis using model: ${modelName}`);
  return result;
}

async function transcribeWithGroq(base64Audio: string, mimeType: string): Promise<string | null> {
  const groqKey = getEnvVar("GROQ_API_KEY");
  if (!groqKey) return null;

  try {
    const cleanMimeType = mimeType.split(";")[0].trim();
    const buffer = Buffer.from(base64Audio, "base64");
    
    // Convert buffer to file-like blob
    const blob = new Blob([buffer], { type: cleanMimeType });
    const formData = new FormData();
    formData.append("file", blob, `audio.${cleanMimeType.split("/")[1] || "webm"}`);
    formData.append("model", "whisper-large-v3");

    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${groqKey}`
      },
      body: formData
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn("[Groq Whisper] Failed to transcribe:", errText);
      return null;
    }

    const result = await response.json();
    console.log("[Groq Whisper] Successfully transcribed audio:", result.text);
    return result.text || null;
  } catch (e: any) {
    console.warn("[Groq Whisper] Error transcribing:", e.message || e);
    return null;
  }
}

export async function analyzeAudio(
  base64Audio: string,
  mimeType: string,
  clientTranscript?: string,
): Promise<AnalysisResult> {
  const groqKey = getEnvVar("GROQ_API_KEY");
  const openRouterKey = getEnvVar("OPENROUTER_API_KEY");
  const geminiKey = getEnvVar("GEMINI_API_KEY");

  // 1. If Groq or OpenRouter key is set, prioritize it directly to avoid Gemini API requests
  if (groqKey || openRouterKey) {
    let transcriptToUse = clientTranscript;

    // If no client transcript is provided (e.g. uploaded file) and we have a Groq key, try to transcribe with Groq Whisper
    if (!transcriptToUse && groqKey) {
      console.log("[API Fallback] No client transcript provided. Attempting transcription using Groq Whisper...");
      transcriptToUse = (await transcribeWithGroq(base64Audio, mimeType)) || undefined;
    }

    // If still no transcript, throw a real error instead of using simulated practice passages or mock filler data
    if (!transcriptToUse) {
      throw new Error("Speech transcript is required for alternative cloud AI analysis. Please speak clearly using the microphone.");
    }

    return await analyzeWithAlternativeLLM(transcriptToUse);
  }

  // 2. If Gemini API key is set, attempt standard phonetic audio analysis
  if (!geminiKey) {
    throw new Error("No API keys (GEMINI_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY) are configured. Please set them in your .env file.");
  }

  // Clean mimeType from parameters like codecs (e.g. "audio/webm;codecs=opus" -> "audio/webm")
  const cleanMimeType = mimeType.split(";")[0].trim();
  console.log(`[Gemini API] Processing pronunciation analysis. MimeType: ${cleanMimeType}`);

  // Construct request payload
  const prompt = `You are a professional English pronunciation coach. Listen carefully to the uploaded English audio.
1. Transcribe the spoken audio verbatim in English. Do not add punctuation marks in the word list (keep it plain words).
2. Evaluate the pronunciation accuracy of each transcribed word.
3. For each word, classify the status as:
   - "ok": Correctly pronounced, clear.
   - "warn": Slurred, hesitations, minor accent mistakes, or slightly unclear.
   - "bad": Plainly mispronounced, incorrect word, or incomprehensible.
4. Calculate an overallScore (0-100) representing their overall pronunciation quality.
5. Provide sub-metrics (0-100) for fluency, rhythm, and completeness.
6. Provide a short, constructive paragraph of feedback to help the speaker improve.`;

  const payload = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: cleanMimeType,
              data: base64Audio,
            },
          },
          {
            text: prompt,
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          overallScore: { type: "INTEGER" },
          metrics: {
            type: "OBJECT",
            properties: {
              fluency: { type: "INTEGER" },
              rhythm: { type: "INTEGER" },
              completeness: { type: "INTEGER" },
            },
            required: ["fluency", "rhythm", "completeness"],
          },
          words: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                text: { type: "STRING" },
                status: { type: "STRING", enum: ["ok", "warn", "bad"] },
              },
              required: ["text", "status"],
            },
          },
          feedback: { type: "STRING" },
        },
        required: ["overallScore", "metrics", "words", "feedback"],
      },
    },
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API returned error status ${response.status}: ${errorText}`);
  }

  const responseJson = await response.json();
  const textResponse = responseJson.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!textResponse) {
    throw new Error("No content received from Gemini model response.");
  }

  try {
    const parsedResult = JSON.parse(textResponse) as AnalysisResult;
    parsedResult.engine = "cloud";
    console.log(`[Gemini API] Successfully analyzed audio using model: gemini-2.0-flash`);
    return parsedResult;
  } catch (error) {
    console.error(`Failed to parse Gemini output text response as JSON:`, textResponse);
    throw new Error("Gemini returned invalid JSON output.");
  }
}
