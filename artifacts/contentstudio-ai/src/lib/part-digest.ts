import type { ProjectPart } from "./storage";

const MAX_VO_CHARS = 600;

function trimMid(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
}

export function buildPartDigest(part: ProjectPart): string {
  const lines: string[] = [];
  lines.push(`Part ${part.partNumber}`);

  if (part.shots && part.shots.length > 0) {
    lines.push(`Shots (${part.shots.length}):`);
    for (const shot of part.shots) {
      const cam = shot.cameraWork ? ` · cam: ${shot.cameraWork}` : "";
      const fx =
        shot.effects && shot.effects.length > 0
          ? ` · fx: ${shot.effects.join(", ")}`
          : "";
      const out = shot.transition ? ` · exit: ${shot.transition}` : "";
      const sig = shot.isSignature ? " [SIGNATURE]" : "";
      lines.push(
        `  ${shot.timestamp ?? ""} ${shot.description}${cam}${fx}${out}${sig}`.trim(),
      );
    }
  }

  if (part.energyArc) {
    lines.push(
      `Energy: a1=${part.energyArc.act1} | a2=${part.energyArc.act2} | a3=${part.energyArc.act3}`,
    );
  }

  if (part.effectsInventory && part.effectsInventory.length > 0) {
    const sig = part.effectsInventory
      .map((e) => `${e.name}${e.role ? ` (${e.role})` : ""}`)
      .join(", ");
    lines.push(`Effects inventory: ${sig}`);
  }

  const vo = part.autoVoiceoverScript;
  if (vo && vo.trim()) {
    lines.push(`Voiceover: ${trimMid(vo.trim(), MAX_VO_CHARS)}`);
  }

  lines.push(`Last frame: ${part.lastFrameDescription}`);

  return lines.join("\n");
}

export function buildPreviousPartDigests(parts: ProjectPart[]): string[] {
  return parts
    .slice()
    .sort((a, b) => a.partNumber - b.partNumber)
    .map(buildPartDigest);
}
