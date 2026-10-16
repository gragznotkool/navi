import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AiPatchResponse, SiteConfiguration, SpeechLang } from "@opshub/contracts";
import { Badge, Button, Panel, SelectField } from "../../components/ui";
import { toRequestError } from "../../lib/api";
import { listen, speechSupported, type Listener } from "../../lib/speech";
import { aiApi } from "../../services";
import { notify } from "../../stores/toast";

const LANGS: { value: SpeechLang; label: string }[] = [
  { value: "en-IN", label: "English" },
  { value: "hi-IN", label: "हिन्दी (Hindi)" },
  { value: "mr-IN", label: "मराठी (Marathi)" },
];

/**
 * "Bolo & Build": say or type a change, get a proposal. The proposal is only ever applied to the builder's
 * DRAFT when the user presses the button; publishing stays a separate, deliberate step.
 */
export function BoloBuildPanel({ siteId, config, onApply }: { siteId: string; config: SiteConfiguration; onApply: (next: SiteConfiguration) => void }) {
  const [lang, setLang] = useState<SpeechLang>("en-IN");
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiPatchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listener = useRef<Listener | null>(null);
  const supported = speechSupported();

  useEffect(() => () => listener.current?.stop(), []);

  const toggleMic = () => {
    if (listening) {
      listener.current?.stop();
      return;
    }
    setVoiceError(null);
    setResult(null);
    const l = listen(lang, {
      onText: setText, // editable afterwards: nothing is sent until the user presses Propose
      onEnd: (err) => {
        setListening(false);
        listener.current = null;
        if (err) setVoiceError(err);
      },
    });
    listener.current = l;
    setListening(l !== null);
  };

  const propose = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await aiApi.patch(siteId, { utterance: text.trim(), lang, configuration: config }));
    } catch (e) {
      setError(toRequestError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const applicable = result?.configuration != null && result.validation?.valid === true && (result.patch?.ops.length ?? 0) > 0 && result.skipped.length < (result.patch?.ops.length ?? 0);

  const apply = () => {
    if (!result?.configuration) return;
    onApply(result.configuration as SiteConfiguration);
    notify.success("Applied to your draft. Review it, then use “Review & publish” when you are happy.");
    setResult(null);
    setText("");
  };

  return (
    <Panel title="Bolo & Build">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted">Say or type a change, such as “add return management”. You review the proposal before anything changes, and nothing is published from here.</p>
        <SelectField label="Language" value={lang} onChange={(e) => setLang(e.target.value as SpeechLang)}>
          {LANGS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </SelectField>
        <div className="flex flex-col gap-1">
          <label htmlFor="bolo-text" className="text-sm font-medium">What should change?</label>
          <textarea
            id="bolo-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={500}
            lang={lang}
            className="rounded-ui border border-line bg-surface p-2 text-sm"
            placeholder={listening ? "Listening…" : "Type here, or press Speak"}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={toggleMic} disabled={!supported} aria-pressed={listening} title={supported ? undefined : "Voice input is not available in this browser"}>
            {listening ? <><Square className="h-3.5 w-3.5" aria-hidden /> Stop</> : <><Mic className="h-3.5 w-3.5" aria-hidden /> Speak</>}
          </Button>
          <Button variant="primary" onClick={() => void propose()} loading={busy} disabled={text.trim().length < 2 || listening}>Propose change</Button>
        </div>
        {!supported && <p className="text-xs text-muted">Voice input is not available in this browser. Typing works the same way.</p>}
        {voiceError && <p role="alert" className="text-xs text-red-700">{voiceError}</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        {result && (
          <div className="flex flex-col gap-2 rounded-ui border border-line p-3 text-sm" aria-label="Proposed change">
            <div className="flex flex-wrap items-center gap-2">
              {result.source === "model" ? <Badge tone="info">AI proposal</Badge> : <Badge tone="warning">Built-in fallback</Badge>}
              <span className="text-xs text-muted">{result.provider}</span>
            </div>
            {result.source === "fallback" && result.fallbackReason && <p className="text-xs text-muted">{result.fallbackReason} Only fixed demo phrases are understood.</p>}
            {result.message && <p role="status">{result.message}</p>}
            {result.sentences.length > 0 && (
              <ul className="list-disc space-y-1 pl-5" aria-label="What this would change">
                {result.sentences.map((s) => <li key={s}>{s}</li>)}
              </ul>
            )}
            {result.skipped.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-xs text-amber-800" aria-label="Not applied">
                {result.skipped.map((s, i) => <li key={i}>{s.reason}</li>)}
              </ul>
            )}
            {result.validation && !result.validation.valid && (
              <ul role="alert" className="list-disc space-y-1 pl-5 text-xs text-red-700" aria-label="Problems">
                {result.validation.errors.map((e, i) => <li key={i}>{e.message}</li>)}
              </ul>
            )}
            {result.impact?.impact?.destructive && <p className="text-xs"><Badge tone="warning">Needs confirmation</Badge> Publishing this affects things that are in use; you will be asked to confirm.</p>}
            {result.configuration != null && (
              <div className="flex gap-2">
                <Button variant="primary" onClick={apply} disabled={!applicable}>Apply to draft</Button>
                <Button onClick={() => setResult(null)}>Discard</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
