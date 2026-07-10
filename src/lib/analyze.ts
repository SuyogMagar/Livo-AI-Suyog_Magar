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
}

export async function analyzeAudio(
  base64Audio: string,
  mimeType: string,
): Promise<AnalysisResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not set on the server.");
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
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
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
    return JSON.parse(textResponse) as AnalysisResult;
  } catch (error) {
    console.error("Failed to parse Gemini output text response as JSON:", textResponse);
    throw new Error("Gemini returned invalid JSON output for the pronunciation assessment.");
  }
}
