import type { ConfigPatch, ModuleType, PatchOp } from "@opshub/contracts";
import { getModuleDefinition } from "../modules/registry.js";

/**
 * Deterministic stand-in used when no AI key is set, the network is down, or the provider fails.
 * It understands a fixed set of demo phrases in English, Hindi and Marathi. It is a keyword matcher,
 * not an AI, and the response always says `source: "fallback"`.
 */

const MODULE_WORDS: { type: ModuleType; words: string[] }[] = [
  { type: "return-management", words: ["return", "returns", "रिटर्न", "वापसी", "परत", "परतावा"] },
  { type: "pcb-repair", words: ["repair", "pcb", "मरम्मत", "दुरुस्ती", "रिपेयर"] },
  { type: "analytics-dashboard", words: ["analytics", "अनालिटिक्स", "एनालिटिक्स", "ॲनालिटिक्स", "विश्लेषण"] },
  { type: "reports-excel", words: ["excel", "report", "reports", "एक्सेल", "रिपोर्ट", "अहवाल"] },
  { type: "consumption-tracking", words: ["consumption", "खपत"] },
  { type: "approval", words: ["approval", "approvals", "मंज़ूरी", "मंजूरी", "मान्यता"] },
];

const ADD_WORDS = ["add", "enable", "turn on", "create", "include", "जोड़", "जोड", "जोडा", "जोडू", "चालू", "शुरू", "लगा"];
const REMOVE_WORDS = ["remove", "delete", "disable", "turn off", "drop", "हटा", "काढ", "बंद", "निकाल"];

const has = (text: string, words: string[]): boolean => words.some((w) => text.includes(w));
const clean = (s: string): string => s.replace(/[“”"'।.!?]+/g, "").trim();

function renameTarget(text: string): string | null {
  const patterns = [
    /rename (?:the |this )?(?:site|hub|depot)?\s*(?:to|as)\s+(.+)$/i,
    /(?:call|name) (?:the |this )?site\s+(.+)$/i,
    /नाम\s+(.+?)\s+(?:रखो|रखें|रखिए|कर दो|करो|बदलो)/,
    /नाव\s+(.+?)\s+(?:ठेवा|ठेव|कर|बदला)/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    const name = m?.[1] ? clean(m[1]) : "";
    if (name.length >= 1 && name.length <= 80) return name;
  }
  return null;
}

export function cannedPatch(utterance: string): ConfigPatch | null {
  const text = utterance.trim().toLowerCase();
  if (text.length === 0) return null;
  const ops: PatchOp[] = [];

  const rename = renameTarget(utterance.trim());
  if (rename) ops.push({ op: "rename-site", name: rename });

  const module = MODULE_WORDS.find((m) => has(text, m.words));
  if (module && !rename) {
    const remove = has(text, REMOVE_WORDS);
    const add = has(text, ADD_WORDS);
    if (remove && !add) ops.push({ op: "remove-module", moduleType: module.type });
    else if (add && !remove) ops.push({ op: "add-module", moduleType: module.type });
  }

  // "give approver access to requests" / "allow dispatcher to view returns"
  const grant = /(?:give|grant|allow)\s+(\w+)\s+(?:access|permission)?\s*(?:to|for)?\s*(?:view|see)?\s*(?:to )?(\w[\w -]*)$/i.exec(utterance.trim());
  if (grant && !rename && ops.length === 0) {
    const target = MODULE_WORDS.find((m) => has((grant[2] ?? "").toLowerCase(), m.words));
    const view = target ? getModuleDefinition(target.type)?.permissions.find((p) => p.endsWith(":view")) : undefined;
    if (target && view && grant[1]) ops.push({ op: "grant-permission", role: grant[1], permission: view });
  }

  return ops.length > 0 ? { ops, summary: "Matched a built-in demo phrase (no AI was used)." } : null;
}
