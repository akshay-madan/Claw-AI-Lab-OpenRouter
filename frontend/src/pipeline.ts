// Stage skipping helpers: which files each stage reads from earlier stages,
// and which files a user can supply when starting at a later layer.
// Mirrors _read_prior_artifact calls in backend/agent/researchclaw/pipeline/
// and START_INPUT_FILES in backend/services/agent_bridge.py.
import { ALL_LAYERS, LAYER_META } from './types';
import type { AgentLayer } from './types';

/** Pipeline stages S1–S22 (no discussion pseudo-stage). */
export const ALL_STAGES: number[] = Array.from({ length: 22 }, (_, i) => i + 1);

export function layerStages(layer: AgentLayer): number[] {
  return LAYER_META[layer].stages.filter((s) => s !== 100);
}

export function stagesOfLayers(layers: Iterable<AgentLayer>): number[] {
  const out: number[] = [];
  for (const l of layers) out.push(...layerStages(l));
  return out;
}

/** Stages of all layers before `start`. */
export function stagesBefore(start: AgentLayer): number[] {
  return stagesOfLayers(ALL_LAYERS.slice(0, ALL_LAYERS.indexOf(start)));
}

/** consumer stage → [file it reads, stage that produces it] */
export const STAGE_INPUTS: Record<number, Array<[string, number]>> = {
  2: [['goal.md', 1]],
  3: [['problem_tree.md', 2]],
  4: [['search_plan.yaml', 3], ['queries.json', 3]],
  5: [['candidates.jsonl', 4]],
  6: [['shortlist.jsonl', 5]],
  7: [['cards/', 6]],
  8: [['synthesis.md', 7], ['candidates.jsonl', 4]],
  9: [['hypotheses.md', 8]],
  10: [['exp_plan.yaml', 9]],
  11: [['exp_plan.yaml', 9], ['codebase_candidates.json', 10]],
  12: [['experiment/main.py', 11]],
  13: [['exp_plan.yaml', 9]],
  14: [['experiment/main.py', 11]],
  15: [['runs/', 14]],
  16: [['runs/', 14], ['refinement_log.json', 15], ['hypotheses.md', 8]],
  17: [['analysis.md', 16], ['refinement_log.json', 15]],
  18: [['analysis.md', 16], ['decision.md', 17], ['exp_plan.yaml', 9], ['hypotheses.md', 8]],
  19: [['analysis.md', 16], ['decision.md', 17]],
  20: [['outline.md', 19], ['analysis.md', 16], ['experiment_summary.json', 16], ['runs/', 14]],
  21: [['paper_draft.md', 20]],
  22: [['paper_draft.md', 20], ['reviews.md', 21]],
};

export interface StartInputSpec { file: string; required: boolean }

/** Files the user can supply when starting at a layer (written to run_dir/stage-XX/). */
export const START_LAYER_INPUTS: Record<AgentLayer, StartInputSpec[]> = {
  idea: [],
  experiment: [{ file: 'hypotheses.md', required: true }],
  coding: [
    { file: 'hypotheses.md', required: true },
    { file: 'exp_plan.yaml', required: true },
  ],
  execution: [
    { file: 'exp_plan.yaml', required: true },
    { file: 'experiment/main.py', required: true },
    { file: 'hypotheses.md', required: false },
  ],
  writing: [
    { file: 'analysis.md', required: true },
    { file: 'decision.md', required: false },
    { file: 'experiment_summary.json', required: false },
    { file: 'hypotheses.md', required: false },
  ],
};

export interface SkipWarning {
  file: string;
  producer: number;   // skipped stage that would write the file
  consumers: number[]; // stages that still run and read it
}

/**
 * Files that later, still-running stages read from a skipped stage and that the
 * user has not supplied. Those stages get empty text for the file.
 */
export function skipWarnings(skip: Set<number>, provided: Set<string> = new Set()): SkipWarning[] {
  const byKey = new Map<string, SkipWarning>();
  for (const consumer of ALL_STAGES) {
    if (skip.has(consumer)) continue;
    for (const [file, producer] of STAGE_INPUTS[consumer] || []) {
      if (!skip.has(producer) || provided.has(file)) continue;
      const key = `${producer}:${file}`;
      const w = byKey.get(key) || { file, producer, consumers: [] };
      w.consumers.push(consumer);
      byKey.set(key, w);
    }
  }
  return [...byKey.values()].sort((a, b) => a.producer - b.producer);
}

/** "S1–S3, S5" style label for a list of stage numbers. */
export function stageRangeLabel(stages: number[]): string {
  const sorted = [...new Set(stages)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    parts.push(start === sorted[i] ? `S${start}` : `S${start}–S${sorted[i]}`);
  }
  return parts.join(', ');
}
