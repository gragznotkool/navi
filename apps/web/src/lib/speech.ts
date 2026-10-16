import type { SpeechLang } from "@opshub/contracts";

/** The subset of the Web Speech API used here (not in every TypeScript DOM lib). */
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

const ctor = (): RecognitionCtor | undefined => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

export const speechSupported = (): boolean => typeof window !== "undefined" && ctor() !== undefined;

/** Plain-language reasons for the errors the browser reports. */
export function speechErrorMessage(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was blocked. Allow it in your browser, or type instead.";
    case "no-speech":
      return "I did not hear anything. Try again, or type instead.";
    case "network":
      return "Voice input needs an internet connection in this browser. Type instead.";
    case "audio-capture":
      return "No microphone was found. Type instead.";
    case "language-not-supported":
      return "This browser does not support that language for voice. Type instead.";
    case "aborted":
      return "";
    default:
      return "Voice input did not work. Type instead.";
  }
}

export interface Listener {
  stop: () => void;
}

/**
 * Starts one recognition session. `onText` receives the full transcript so far (interim included).
 * `onEnd` always fires exactly once, with an error message only when something went wrong.
 */
export function listen(lang: SpeechLang, handlers: { onText: (text: string) => void; onEnd: (error: string | null) => void }): Listener | null {
  const Ctor = ctor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = false;
  rec.interimResults = true;
  let error: string | null = null;
  let ended = false;
  rec.onresult = (e) => {
    let text = "";
    for (let i = 0; i < e.results.length; i++) text += e.results[i]![0]?.transcript ?? "";
    handlers.onText(text.trim());
  };
  rec.onerror = (e) => {
    error = speechErrorMessage(e.error) || null;
  };
  rec.onend = () => {
    if (ended) return;
    ended = true;
    handlers.onEnd(error);
  };
  try {
    rec.start();
  } catch {
    handlers.onEnd("Voice input could not start. Type instead.");
    return null;
  }
  return { stop: () => rec.stop() };
}
