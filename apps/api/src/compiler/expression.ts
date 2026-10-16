import jsep from "jsep";

type ValueType = "number" | "string" | "boolean";

export interface ExpressionIssue {
  code: string;
  message: string;
}

const ALLOWED_BINARY = new Set(["+", "-", "*", "/", "%", "<", ">", "<=", ">=", "==", "!=", "&&", "||"]);
const ALLOWED_UNARY = new Set(["-", "!"]);

/** Allowed functions and their (fixed) argument and result types. No other calls are permitted. */
const FUNCTIONS: Record<string, { args: ValueType[]; result: ValueType }> = {
  min: { args: ["number", "number"], result: "number" },
  max: { args: ["number", "number"], result: "number" },
  abs: { args: ["number"], result: "number" },
  round: { args: ["number"], result: "number" },
};

/** Hard limits so a hostile or accidental expression cannot exhaust the parser or the stack. */
export const MAX_EXPRESSION_LENGTH = 500;
const MAX_DEPTH = 24;

const own = <T>(table: Record<string, T>, key: string): T | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);

interface Node {
  type: string;
  [key: string]: unknown;
}

/**
 * Parses and type-checks an expression without ever executing it.
 * Returns the inferred result type or a list of issues.
 */
export function checkExpression(
  expression: string,
  inputs: Record<string, ValueType>,
): { resultType?: ValueType; issues: ExpressionIssue[] } {
  const issues: ExpressionIssue[] = [];
  if (typeof expression !== "string" || expression.length > MAX_EXPRESSION_LENGTH) {
    return { issues: [{ code: "expression.too-long", message: `Expressions are limited to ${MAX_EXPRESSION_LENGTH} characters` }] };
  }
  let ast: Node;
  try {
    ast = jsep(expression) as unknown as Node;
  } catch (e) {
    return {
      issues: [{ code: "expression.parse", message: e instanceof Error ? e.message : "parse error" }],
    };
  }
  const fail = (code: string, message: string): undefined => {
    issues.push({ code, message });
    return undefined;
  };

  const visit = (n: Node, depth = 0): ValueType | undefined => {
    if (depth > MAX_DEPTH) return fail("expression.too-deep", "Expression is nested too deeply");
    switch (n.type) {
      case "Literal": {
        const v = n.value;
        if (typeof v === "number") return "number";
        if (typeof v === "string") return "string";
        if (typeof v === "boolean") return "boolean";
        return fail("expression.literal", "Unsupported literal");
      }
      case "Identifier": {
        const name = String(n.name);
        const t = own(inputs, name);
        return t ?? fail("expression.unknown-input", `Unknown input "${name}"`);
      }
      case "UnaryExpression": {
        const op = String(n.operator);
        if (!ALLOWED_UNARY.has(op)) return fail("expression.operator", `Unsupported operator "${op}"`);
        const t = visit(n.argument as Node, depth + 1);
        if (t === undefined) return undefined;
        const want = op === "!" ? "boolean" : "number";
        if (t !== want) return fail("expression.type", `Operator "${op}" requires ${want}`);
        return want;
      }
      case "BinaryExpression": {
        const op = String(n.operator);
        if (!ALLOWED_BINARY.has(op)) return fail("expression.operator", `Unsupported operator "${op}"`);
        const l = visit(n.left as Node, depth + 1);
        const r = visit(n.right as Node, depth + 1);
        if (l === undefined || r === undefined) return undefined;
        if (["+", "-", "*", "/", "%"].includes(op)) {
          if (l !== "number" || r !== "number") return fail("expression.type", `Operator "${op}" requires numbers`);
          return "number";
        }
        if (["<", ">", "<=", ">="].includes(op)) {
          if (l !== "number" || r !== "number") return fail("expression.type", `Operator "${op}" requires numbers`);
          return "boolean";
        }
        if (op === "&&" || op === "||") {
          if (l !== "boolean" || r !== "boolean") return fail("expression.type", `Operator "${op}" requires booleans`);
          return "boolean";
        }
        if (l !== r) return fail("expression.type", `Cannot compare ${l} with ${r}`);
        return "boolean";
      }
      case "CallExpression": {
        const callee = n.callee as Node;
        if (callee.type !== "Identifier") return fail("expression.call", "Only plain function calls are allowed");
        const name = String(callee.name);
        const fn = own(FUNCTIONS, name);
        if (!fn) return fail("expression.function", `Function "${name}" is not allowed`);
        const args = n.arguments as Node[];
        if (args.length !== fn.args.length) {
          return fail("expression.arity", `${name} expects ${fn.args.length} argument(s)`);
        }
        let ok = true;
        args.forEach((a, i) => {
          const t = visit(a, depth + 1);
          if (t === undefined) ok = false;
          else if (t !== fn.args[i]) {
            ok = false;
            fail("expression.type", `Argument ${i + 1} of ${name} must be ${fn.args[i]}`);
          }
        });
        return ok ? fn.result : undefined;
      }
      default:
        return fail("expression.syntax", `Unsupported syntax "${n.type}"`);
    }
  };

  const resultType = visit(ast);
  return issues.length > 0 ? { issues } : { resultType, issues };
}
