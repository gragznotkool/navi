import { useState, useEffect, useRef } from "react";
import { Mic, MicOff, Sparkles, Send, Bot, CheckCircle2, AlertCircle, Languages } from "lucide-react";
import type { ModuleDefinition, SiteConfiguration } from "@opshub/contracts";
import { Button } from "../../components/ui";
import { notify } from "../../stores/toast";
import { addEdge, addModule, edgeIdOf } from "./configOps";

interface BoloAndBuildProps {
  config: SiteConfiguration;
  defs: readonly ModuleDefinition[];
  onApplyConfig: (nextConfig: SiteConfiguration, message: string) => void;
}

type LangOption = { code: string; label: string; name: string };
const SUPPORTED_LANGS: LangOption[] = [
  { code: "en-IN", label: "EN", name: "English (India)" },
  { code: "hi-IN", label: "हिं", name: "हिन्दी (Hindi)" },
  { code: "mr-IN", label: "मरा", name: "मराठी (Marathi)" },
];

/**
 * Natural language intent parser for Electrolyte operations & modular assembly.
 * Understands English, Hindi, and Marathi commands for industrial flows.
 */
function parseVoiceInstruction(
  transcript: string,
  config: SiteConfiguration,
  defs: readonly ModuleDefinition[]
): {
  success: boolean;
  message: string;
  modulesToAdd: string[];
  edgesToConnect: { source: string; target: string; reason?: string }[];
} {
  const t = transcript.toLowerCase();
  const modulesToAdd = new Set<string>();
  const edgesToConnect: { source: string; target: string; reason?: string }[] = [];

  // Keywords mapping for Electrolyte Solutions operations in en-IN, hi-IN, mr-IN:
  // 1. Returns / Damaged goods / W-Waste / ewaste
  const hasReturns =
    t.includes("return") ||
    t.includes("वापसी") ||
    t.includes("परतावा") ||
    t.includes("damage") ||
    t.includes("खराब") ||
    t.includes("rma") ||
    t.includes("defect");

  // 2. PCB Repair / L3 L4 / Component repair / soldering / BGA
  const hasRepair =
    t.includes("repair") ||
    t.includes("मरम्मत") ||
    t.includes("दुरुस्ती") ||
    t.includes("pcb") ||
    t.includes("bga") ||
    t.includes("soldering") ||
    t.includes("l3") ||
    t.includes("l4");

  // 3. Inventory / Stock / Components / Parts
  const hasInventory =
    t.includes("inventory") ||
    t.includes("stock") ||
    t.includes("स्टॉक") ||
    t.includes("गोदाम") ||
    t.includes("साठा") ||
    t.includes("part") ||
    t.includes("component");

  // 4. Approval / Signoff / QC Gate
  const hasApproval =
    t.includes("approval") ||
    t.includes("approve") ||
    t.includes("मंजूरी") ||
    t.includes("संमती") ||
    t.includes("signoff") ||
    t.includes("gate") ||
    t.includes("qc");

  // 5. Consumption / Usage / Cannibalization
  const hasConsumption =
    t.includes("consumption") ||
    t.includes("consume") ||
    t.includes("खपत") ||
    t.includes("वापर") ||
    t.includes("harvest") ||
    t.includes("cannibaliz");

  // 6. Analytics / Dashboard / Metrics / ZED
  const hasAnalytics =
    t.includes("analytic") ||
    t.includes("report") ||
    t.includes("dashboard") ||
    t.includes("रिपोर्ट") ||
    t.includes("तपशील") ||
    t.includes("metric") ||
    t.includes("zed");

  // Intent resolution:
  if (hasReturns) {
    modulesToAdd.add("return-management");
  }
  if (hasRepair) {
    modulesToAdd.add("pcb-repair");
  }
  if (hasInventory) {
    modulesToAdd.add("inventory");
  }
  if (hasApproval) {
    modulesToAdd.add("approval");
    modulesToAdd.add("request");
  }
  if (hasConsumption) {
    modulesToAdd.add("consumption-tracking");
  }
  if (hasAnalytics) {
    modulesToAdd.add("analytics-dashboard");
  }

  // Explicit constraint check from prompt: "Add Returns, damaged items don't go to stock"
  const isolateFromStock =
    (t.includes("don't go to stock") ||
      t.includes("not to stock") ||
      t.includes("स्टॉकमध्ये नाही") ||
      t.includes("स्टॉक में नहीं") ||
      t.includes("damaged items don't go to stock")) &&
    hasReturns;

  // If specific modules detected, figure out wiring
  if (modulesToAdd.has("return-management") && !isolateFromStock && modulesToAdd.has("inventory")) {
    edgesToConnect.push({
      source: "return-management",
      target: "inventory",
      reason: "Restock approved returns into component inventory",
    });
  }

  if (modulesToAdd.has("pcb-repair") && modulesToAdd.has("consumption-tracking")) {
    edgesToConnect.push({
      source: "pcb-repair",
      target: "consumption-tracking",
      reason: "Track spare IC & flux consumption per repair intake",
    });
  }

  if (modulesToAdd.has("request") && modulesToAdd.has("approval")) {
    edgesToConnect.push({
      source: "request",
      target: "approval",
      reason: "Gate component requisition through technician lead approval",
    });
  }

  // Fallback keyword scanning for module type names
  defs.forEach((d) => {
    if (t.includes(d.type) || t.includes(d.displayName.toLowerCase())) {
      modulesToAdd.add(d.type);
    }
  });

  if (modulesToAdd.size === 0) {
    return {
      success: false,
      message: `Could not derive architectural intent from: "${transcript}". Try saying: "Add Returns and PCB Repair", "स्टॉक आणि मंजुरी जोडा", or "Add Returns, damaged items don't go to stock".`,
      modulesToAdd: [],
      edgesToConnect: [],
    };
  }

  const addedList = Array.from(modulesToAdd);
  const feedbackMsg = isolateFromStock
    ? `Configured ${addedList.join(", ")} isolated from Inventory (Damaged items quarantine rule applied).`
    : `Synthesized architecture: added [${addedList.join(", ")}]${
        edgesToConnect.length ? ` with ${edgesToConnect.length} typed wire(s)` : ""
      }.`;

  return {
    success: true,
    message: feedbackMsg,
    modulesToAdd: addedList,
    edgesToConnect,
  };
}

export function BoloAndBuild({ config, defs, onApplyConfig }: BoloAndBuildProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [lang, setLang] = useState<string>("en-IN");
  const [query, setQuery] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [aiStatus, setAiStatus] = useState<"idle" | "listening" | "synthesizing" | "success" | "error">("idle");
  const [feedback, setFeedback] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = lang;

      recognition.onstart = () => {
        setIsListening(true);
        setAiStatus("listening");
      };

      recognition.onresult = (event: any) => {
        const text = Array.from(event.results)
          .map((r: any) => r[0].transcript)
          .join("");
        setQuery(text);
      };

      recognition.onerror = (err: any) => {
        console.warn("Speech recognition error:", err);
        setIsListening(false);
        setAiStatus("idle");
        notify.info("Voice input unavailable or timed out. You can also type your command.");
      };

      recognition.onend = () => {
        setIsListening(false);
        if (aiStatus === "listening") {
          setAiStatus("idle");
        }
      };

      recognitionRef.current = recognition;
    }
  }, [lang, aiStatus]);

  const toggleListen = () => {
    if (!recognitionRef.current) {
      notify.error("Speech Recognition is not supported by your browser. Please type your prompt.");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      setAiStatus("idle");
    } else {
      setQuery("");
      setFeedback(null);
      try {
        recognitionRef.current.lang = lang;
        recognitionRef.current.start();
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handleExecute = (promptText = query) => {
    if (!promptText.trim()) return;
    setAiStatus("synthesizing");

    setTimeout(() => {
      const parsed = parseVoiceInstruction(promptText, config, defs);
      if (!parsed.success) {
        setAiStatus("error");
        setFeedback(parsed.message);
        notify.error("Bolo & Build: Unrecognized instruction");
        return;
      }

      let nextConfig = config;
      let count = 0;

      // 1. Add modules
      for (const mType of parsed.modulesToAdd) {
        const def = defs.find((d) => d.type === mType);
        if (def && !nextConfig.modules.nodes.some((n) => n.moduleType === def.type)) {
          const pos = {
            x: 100 + (nextConfig.modules.nodes.length % 3) * 290,
            y: 80 + Math.floor(nextConfig.modules.nodes.length / 3) * 190,
          };
          nextConfig = addModule(nextConfig, def, pos);
          count++;
        }
      }

      // 2. Wire edges if feasible
      for (const edgeReq of parsed.edgesToConnect) {
        const srcNode = nextConfig.modules.nodes.find((n) => n.moduleType === edgeReq.source);
        const tgtNode = nextConfig.modules.nodes.find((n) => n.moduleType === edgeReq.target);
        if (srcNode && tgtNode) {
          const srcDef = defs.find((d) => d.type === srcNode.moduleType);
          const tgtDef = defs.find((d) => d.type === tgtNode.moduleType);
          const outPort = srcDef?.ports.find((p) => p.direction === "output");
          const inPort = tgtDef?.ports.find((p) => p.direction === "input");
          if (outPort && inPort) {
            nextConfig = addEdge(nextConfig, {
              sourceNodeId: srcNode.id,
              sourcePortId: outPort.id,
              targetNodeId: tgtNode.id,
              targetPortId: inPort.id,
            });
          }
        }
      }

      setAiStatus("success");
      setFeedback(parsed.message);
      onApplyConfig(nextConfig, parsed.message);
      notify.success(parsed.message);
    }, 600);
  };

  const samplePrompts = [
    "Add Returns, damaged items don't go to stock",
    "Add PCB Repair and Component Consumption for L3 technician intake",
    "वापसी आणि गुणवत्ता नियंत्रण (Returns and QC) जोडा",
    "स्टॉक और रीपेयर मॉड्यूल जोड़ें (Add Stock and Repair modules)",
  ];

  return (
    <div className="relative mb-3">
      {/* Pill Trigger */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-[#1E293B] bg-[#FFFFFF] p-2.5 shadow-[3px_3px_0px_#1E293B] dark:border-[#334155] dark:bg-[#131B2E] dark:shadow-[3px_3px_0px_#020617]">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border-2 border-[#1E293B] bg-[#FBBC04] shadow-[1px_1px_0px_#1E293B]">
            <Sparkles className="h-4 w-4 text-[#1E293B]" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-['Outfit',sans-serif] text-xs font-black uppercase tracking-wider text-[#1E293B] dark:text-white">
                Bolo & Build
              </span>
              <span className="rounded-full border border-[#1E293B] bg-[#4285F4]/10 px-2 py-0.2 font-mono text-[10px] font-bold text-[#1E293B] dark:border-[#334155] dark:bg-[#4285F4]/20 dark:text-[#93C5FD]">
                AI Architect (hi-IN · mr-IN · en-IN)
              </span>
            </div>
            <p className="text-[11px] font-medium text-[#64748B] dark:text-slate-400">
              Speak or type natural language to synthesize React Flow configurations on the fly
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={isOpen ? "secondary" : "blue"}
            onClick={() => setIsOpen(!isOpen)}
            className="h-8 text-xs"
          >
            {isOpen ? "Close Assistant" : "Open Bolo & Build"}
          </Button>
        </div>
      </div>

      {/* Expanded Assistant Tray */}
      {isOpen && (
        <div className="mt-2 rounded-xl border-2 border-[#1E293B] bg-[#F8FAFC] p-4 shadow-[4px_4px_0px_#1E293B] transition-all animate-in fade-in slide-in-from-top-2 dark:border-[#334155] dark:bg-[#0F172A] dark:shadow-[4px_4px_0px_#020617]">
          <div className="flex flex-col gap-3">
            {/* Input + Mic Controls */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Language Switcher */}
              <div className="flex items-center rounded-lg border-2 border-[#1E293B] bg-white p-0.5 shadow-[1px_1px_0px_#1E293B] dark:border-[#334155] dark:bg-[#1E293B] dark:shadow-[1px_1px_0px_#020617]">
                <Languages className="ml-1.5 h-3.5 w-3.5 text-[#64748B] dark:text-slate-400" />
                {SUPPORTED_LANGS.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => setLang(l.code)}
                    title={l.name}
                    className={`rounded-md px-2 py-1 font-mono text-xs font-bold transition-colors ${
                      lang === l.code
                        ? "bg-[#1E293B] text-white dark:bg-[#4285F4]"
                        : "text-[#64748B] hover:text-[#1E293B] dark:text-slate-400 dark:hover:text-white"
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>

              {/* Text Input */}
              <div className="relative min-w-[280px] flex-1">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleExecute()}
                  placeholder={
                    isListening
                      ? "Listening to speech..."
                      : `e.g. "Add Returns, damaged items don't go to stock" (${SUPPORTED_LANGS.find((l) => l.code === lang)?.name})`
                  }
                  className="h-10 w-full rounded-xl border-2 border-[#1E293B] bg-white pl-3 pr-10 text-xs font-medium text-[#0F172A] shadow-[2px_2px_0px_#1E293B] placeholder:text-[#94A3B8] focus:border-[#4285F4] focus:outline-none dark:border-[#334155] dark:bg-[#1E293B] dark:text-white dark:placeholder:text-slate-500 dark:shadow-[2px_2px_0px_#020617]"
                />
                <button
                  type="button"
                  onClick={toggleListen}
                  title={isListening ? "Stop listening" : "Speak in " + lang}
                  className={`absolute right-1.5 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-lg border-2 border-[#1E293B] transition-all shadow-[1px_1px_0px_#1E293B] ${
                    isListening
                      ? "bg-[#EA4335] text-white animate-pulse"
                      : "bg-[#FBBC04] text-[#1E293B] hover:bg-[#F59E0B]"
                  }`}
                >
                  {isListening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                </button>
              </div>

              <Button
                variant="primary"
                onClick={() => handleExecute()}
                disabled={!query.trim() || aiStatus === "synthesizing"}
                loading={aiStatus === "synthesizing"}
                className="h-10 text-xs font-black uppercase"
              >
                <Send className="mr-1 h-3.5 w-3.5" /> Synthesize
              </Button>
            </div>

            {/* Quick Demo Chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#64748B] dark:text-slate-400">
                Try saying:
              </span>
              {samplePrompts.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setQuery(p);
                    handleExecute(p);
                  }}
                  className="rounded-lg border-2 border-[#1E293B] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#1E293B] shadow-[1px_1px_0px_#1E293B] transition hover:bg-[#FBBC04]/20 hover:border-[#1E293B] dark:border-[#334155] dark:bg-[#1E293B] dark:text-slate-200 dark:shadow-[1px_1px_0px_#020617] dark:hover:border-[#FBBC04]"
                >
                  &ldquo;{p}&rdquo;
                </button>
              ))}
            </div>

            {/* Feedback / Synthesis Status */}
            {feedback && (
              <div
                className={`flex items-start gap-2 rounded-lg border-2 border-[#1E293B] p-2.5 text-xs font-semibold shadow-[2px_2px_0px_#1E293B] ${
                  aiStatus === "error"
                    ? "bg-[#FEE2E2] text-[#991B1B] dark:bg-[#450a0a] dark:text-rose-300 dark:border-rose-900"
                    : "bg-[#DCFCE7] text-[#166534] dark:bg-[#052e16] dark:text-emerald-300 dark:border-emerald-900"
                }`}
              >
                {aiStatus === "error" ? (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span>{feedback}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
