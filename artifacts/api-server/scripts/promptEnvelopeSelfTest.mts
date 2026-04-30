/**
 * Smoke test for promptEnvelope.buildJsonPrompt — verifies the
 * pipeline-fix invariants:
 *   1. Output is always valid JSON (parseable).
 *   2. Output is always ≤ 4500 chars.
 *   3. Stable key ordering.
 *   4. Drop order respected.
 *   5. Deeply-nested string truncation works (no [object Object]).
 *
 * Run with: pnpm --filter @workspace/api-server exec tsx scripts/promptEnvelopeSelfTest.mts
 */

import {
  buildJsonPrompt,
  MAX_PROMPT_CHARS,
} from "../src/video/lib/promptEnvelope";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass += 1;
    console.log("PASS", name);
  } else {
    fail += 1;
    console.log("FAIL", name, detail ?? "");
  }
}

// 1. Tiny spec — passes through unchanged.
{
  const out = buildJsonPrompt({ a: 1, b: "hi" }, { label: "tiny" });
  check("tiny: parseable", JSON.parse(out) !== null);
  check("tiny: ≤ cap", out.length <= MAX_PROMPT_CHARS);
  check("tiny: stable order", out === '{"a":1,"b":"hi"}');
}

// 2. Drop order — least-critical fields removed first.
{
  const big = "x".repeat(5000);
  const out = buildJsonPrompt(
    { mainAction: "action", chunkRules: big, endStateForNextPart: big },
    { dropOrder: ["endStateForNextPart", "chunkRules"], label: "drop" },
  );
  const parsed = JSON.parse(out);
  check("drop: parseable", typeof parsed === "object");
  check("drop: ≤ cap", out.length <= MAX_PROMPT_CHARS, out.length);
  check("drop: kept mainAction", parsed.mainAction === "action");
  check("drop: dropped endStateForNextPart", !("endStateForNextPart" in parsed));
}

// 3. Deeply-nested string gets shaved (no [object Object]).
{
  const longStr = "y".repeat(6000);
  const out = buildJsonPrompt(
    {
      videoDirection: { mainAction: longStr, lighting: "soft key" },
      partNumber: 1,
    },
    { label: "deep" },
  );
  const parsed = JSON.parse(out);
  check("deep: parseable", parsed && typeof parsed === "object");
  check("deep: ≤ cap", out.length <= MAX_PROMPT_CHARS, out.length);
  check(
    "deep: no [object Object]",
    !out.includes("[object Object]"),
    out.slice(0, 200),
  );
  check(
    "deep: nested string truncated",
    typeof parsed.videoDirection?.mainAction === "string" &&
      parsed.videoDirection.mainAction.length < longStr.length,
  );
  check(
    "deep: lighting preserved",
    parsed.videoDirection?.lighting === "soft key",
  );
}

// 4. Pathological — every single field is huge.
{
  const huge = "z".repeat(20000);
  const out = buildJsonPrompt(
    {
      a: huge,
      b: huge,
      c: huge,
      d: { nested: huge },
    },
    { label: "huge" },
  );
  check("huge: parseable", (() => { try { JSON.parse(out); return true; } catch { return false; } })(), out.length);
  check("huge: ≤ cap", out.length <= MAX_PROMPT_CHARS, out.length);
}

console.log("");
console.log(`Total: ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
