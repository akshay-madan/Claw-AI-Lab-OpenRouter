import { AgentLayer, STAGE_META, LAYER_META, RepoId } from './types';
import type { LobsterAgent, WSMessage, Artifact, RCStage as RCStageT } from './types';

let counter = 0;
const uid = () => `m-${++counter}-${Date.now()}`;
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function makeAgent(id: string, name: string, layer: AgentLayer, runId: string): LobsterAgent {
  const stages = LAYER_META[layer].stages;
  const progress: Record<number, 'pending'> = {};
  for (const s of stages) progress[s] = 'pending';
  return { id, name, layer, status: 'idle', currentStage: null, currentTask: '', stageProgress: progress, runId };
}

export const INITIAL_AGENTS: LobsterAgent[] = [
  makeAgent('L1-01', '🦞 Lead Researcher·Alpha',     AgentLayer.IDEA,       'run-001'),
  makeAgent('L1-02', '🦞 Researcher·Beta',       AgentLayer.IDEA,       'run-002'),
  makeAgent('L2-01', '🦞 Experimenter·α',          AgentLayer.EXPERIMENT, 'run-001'),
  makeAgent('L2-02', '🦞 Experimenter·β',          AgentLayer.EXPERIMENT, 'run-002'),
  makeAgent('L3-01', '🦞 Coder·A',           AgentLayer.CODING,     'run-001'),
  makeAgent('L3-02', '🦞 Coder·B',           AgentLayer.CODING,     'run-002'),
  makeAgent('L3-03', '🦞 Coder·C',           AgentLayer.CODING,     'run-003'),
  makeAgent('L4-01', '🦞 Executor·1',         AgentLayer.EXECUTION,  'run-001'),
  makeAgent('L4-02', '🦞 Executor·2',         AgentLayer.EXECUTION,  'run-002'),
  makeAgent('L4-03', '🦞 Executor·3',         AgentLayer.EXECUTION,  'run-003'),
  makeAgent('L4-04', '🦞 Executor·4',         AgentLayer.EXECUTION,  'run-004'),
];

const TASK_DETAILS: Record<number, string[]> = {
  1:  ['Parsing research topic, generating SMART goals...', 'Detecting hardware (GPU/CPU)...'],
  2:  ['Breaking the topic into a sub-problem tree...', 'Choosing priority research directions...'],
  3:  ['Planning search strategy, choosing data sources...', 'Generating keyword query combinations...'],
  4:  ['Searching papers via the OpenAlex API...', 'Collecting citations from Semantic Scholar...', 'Scanning the latest arXiv preprints...'],
  5:  ['Screening literature by relevance and quality...', 'Assessing shortlist coverage... [GATE]'],
  6:  ['Extracting knowledge cards from screened papers...', 'Structuring key findings...'],
  7:  ['Clustering research themes, identifying gaps...', 'Synthesizing conclusions across papers...'],
  8:  ['Generating falsifiable hypotheses...', 'Multi-agent debate to evaluate hypotheses...'],
  9:  ['Designing experiment plan (YAML)...', 'Choosing baselines and evaluation metrics... [GATE]', 'Planning ablation matrix...'],
  11: ['Estimating GPU needs and runtime...', 'Generating schedule.json...'],
  10: ['Generating core experiment code...', 'Validating code with AST checks...', 'Adapting to the hardware...', 'Writing evaluation scripts...'],
  12: ['Running experiment code in the sandbox...', 'Monitoring for NaN/Inf...', 'Submitting training jobs to the cluster...'],
  13: ['Edit-run-evaluate loop...', 'LLM fixing failing cases...', 'Evaluating convergence...'],
  14: ['Analyzing experiment metrics...', 'Generating charts...', 'Multi-agent results review...'],
  15: ['Making research decision: PROCEED / PIVOT / REFINE...', 'Recording decision history...'],
};

const LOG_TEMPLATES: Record<string, Array<{ msg: string; level: 'info' | 'success' | 'warning' | 'error' }>> = {
  [AgentLayer.IDEA]: [
    { msg: 'Found 5 highly relevant new papers (OpenAlex)', level: 'info' },
    { msg: 'Literature screening passed: shortlist 12 → 8 papers', level: 'success' },
    { msg: 'Knowledge card extraction complete: 8 cards', level: 'success' },
    { msg: 'Semantic Scholar API rate-limited, waiting to retry...', level: 'warning' },
    { msg: 'Synthesis found 3 research gaps', level: 'info' },
    { msg: 'Generated 2 falsifiable hypotheses', level: 'success' },
    { msg: 'arXiv connection timed out', level: 'error' },
    { msg: 'Hypothesis debate: 2/3 agents agree, 1 disagrees → passed', level: 'info' },
  ],
  [AgentLayer.EXPERIMENT]: [
    { msg: 'Experiment plan: 5 controls + 3 ablations', level: 'success' },
    { msg: 'Estimated GPU need: 4×A100, ~12h', level: 'info' },
    { msg: 'Insufficient resources: need 8×A100 but only 4× available', level: 'warning' },
    { msg: 'Experiment plan passed GATE review', level: 'success' },
    { msg: 'schedule.json generated', level: 'info' },
    { msg: 'Baseline chosen: LLaMA-7B + LoRA', level: 'info' },
  ],
  [AgentLayer.CODING]: [
    { msg: 'Data preprocessing pipeline written', level: 'success' },
    { msg: 'Core model module: AST validation passed', level: 'success' },
    { msg: 'Lint check: 2 warnings, 0 errors', level: 'warning' },
    { msg: 'Training loop + WandB logging integrated', level: 'success' },
    { msg: 'Type error: Tensor shape mismatch [B,S,D]', level: 'error' },
    { msg: 'Evaluation scripts (BLEU/ROUGE/F1) written', level: 'success' },
    { msg: 'Code committed to the experiment/ directory', level: 'info' },
  ],
  [AgentLayer.EXECUTION]: [
    { msg: 'Training job submitted (sandbox: docker)', level: 'info' },
    { msg: 'Epoch 3/10, loss=1.87, lr=2e-4', level: 'info' },
    { msg: 'CUDA OOM! Lowering batch_size 16→8 and retrying', level: 'error' },
    { msg: 'Refinement #2: gradient clipping max_norm=1.0', level: 'warning' },
    { msg: 'Evaluation complete: BLEU=32.5, ROUGE-L=41.2', level: 'success' },
    { msg: 'Loss divergence detected → rolling back to checkpoint-ep5', level: 'warning' },
    { msg: 'Result analysis: H1 significant (p<0.01), H2 not significant', level: 'success' },
    { msg: 'Decision: PROCEED → experiment met expectations', level: 'success' },
    { msg: 'Decision: PIVOT → back to hypothesis generation to re-explore', level: 'warning' },
  ],
};

function stageToRepo(stage: RCStageT): RepoId | null {
  if (stage <= 8) return RepoId.KNOWLEDGE;
  if (stage === 9 || stage === 11) return RepoId.EXP_DESIGN;
  if (stage === 10) return RepoId.CODEBASE;
  if (stage >= 12) return RepoId.RESULTS;
  return null;
}

export function createMockMessageGenerator(onMessage: (msg: WSMessage) => void): () => void {
  const intervals: number[] = [];
  const agents = [...INITIAL_AGENTS];
  const agentMap = new Map(agents.map((a) => [a.id, { ...a }]));

  const emitAgentActivity = () => {
    const agent = pick(agents);
    const state = agentMap.get(agent.id)!;
    const layerStages = LAYER_META[agent.layer].stages;
    const roll = Math.random();

    if (roll < 0.5 && state.status !== 'working') {
      const stage = pick(layerStages);
      state.status = 'working';
      state.currentStage = stage;
      state.currentTask = pick(TASK_DETAILS[stage] || ['Processing...']);
      state.stageProgress[stage] = 'running';
    } else if (roll < 0.75 && state.currentStage) {
      state.stageProgress[state.currentStage] = 'completed';
      state.status = 'done';
      state.currentTask = '';

      const repo = stageToRepo(state.currentStage);
      if (repo) {
        const outputs = STAGE_META[state.currentStage].outputs;
        const file = pick(outputs);
        const artifact: Artifact = {
          id: uid(),
          repoId: repo,
          projectId: agent.runId,
          filename: file,
          producedBy: agent.name,
          timestamp: Date.now(),
          size: `${(Math.random() * 100 + 1).toFixed(1)} KB`,
          status: 'fresh',
        };
        onMessage({ type: 'artifact_produced', payload: artifact });
      }

      const nextStage = state.currentStage;
      state.currentStage = null;
      onMessage({
        type: 'stage_update',
        payload: { agentId: agent.id, stage: nextStage, status: 'completed' },
      });
    } else if (roll < 0.85 && state.currentStage) {
      state.stageProgress[state.currentStage] = 'failed';
      state.status = 'error';
      state.currentTask = 'Run failed, waiting to retry...';
    } else {
      state.status = 'idle';
      state.currentStage = null;
      state.currentTask = '';
    }

    agentMap.set(agent.id, { ...state });
    onMessage({ type: 'agent_update', payload: { ...state } });

    if (state.status !== 'idle') {
      const templates = LOG_TEMPLATES[agent.layer];
      const tmpl = state.status === 'error'
        ? templates.find((t) => t.level === 'error') || pick(templates)
        : pick(templates);
      onMessage({
        type: 'log',
        payload: {
          id: uid(),
          agentId: agent.id,
          agentName: agent.name,
          layer: agent.layer,
          stage: state.currentStage,
          message: tmpl.msg,
          level: tmpl.level,
          timestamp: Date.now(),
        },
      });
    }
  };

  intervals.push(
    window.setInterval(emitAgentActivity, 1500 + Math.random() * 2000),
  );

  setTimeout(emitAgentActivity, 300);
  setTimeout(emitAgentActivity, 800);

  return () => intervals.forEach(clearInterval);
}
