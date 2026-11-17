# Claw AI Lab — UI Guide

Open **http://localhost:5903/** after `./lab.sh start-app`.

```
┌──────── Header: stats · ● Running/Stopped · ▶ Start / ⏹ Stop · Resume all · ☀️/🌙 · 中文/EN ────────┐
│ PROJECTS (left)       │ RESOURCES + AGENT PYRAMID (center)     │ EVENT LOG + DATA STORES (right) │
│ submit / manage runs  │ L1 → L5 layers, live agent status      │ live events, download outputs   │
├───────────────────────┴────────────────────────────────────────┴─────────────────────────────────┤
│ HUMAN FEEDBACK (bottom): ask status or steer the agents                                          │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 1. Start a project (left panel)

1. **Pick a mode** (click **?** for help):
   | Mode | What it does |
   |---|---|
   | **Lab·Discuss** *(recommended)* | Several research angles in parallel → agents debate after S7 → one consensus hypothesis |
   | **Lab·Solo** | Same parallel angles, but each makes its own hypotheses. Faster, no consensus |
   | **Reproduce** | One agent reproduces a given paper end-to-end |
2. **Topic** — e.g. *"Research latest advances in video action models for embodied AI"*, or for Reproduce: *"Reproduce SwitchCraft (arXiv:2602.23956)"*.
3. **Research angles** *(Lab modes, optional)* — separate with `;` e.g. `CV; VLM; World Model`. Empty = 3 auto-chosen angles.
4. **Reference Papers** *(optional)* — arXiv ID / URL / title, or **Pick local PDF**.
5. **Configuration** *(optional)* — local **codebases / datasets / checkpoints** paths. Strongly recommended: avoids slow or failed downloads.
6. **Pipeline stages** *(optional)* — skip stages, or start at a later layer with your own files. See [Skip stages or layers](#2c-skip-stages-or-layers).
7. Click **Submit**.

## 2. Start, stop, resume (header)

- **● Running / ● Stopped** — whether the agent system is up.
- **⏹ Stop** — stops all agents (asks first). Completed stages are kept; a stage that was mid-run restarts from its beginning on resume. The page stays open.
- **▶ Start** — starts the agents again. Queued projects continue on their own; interrupted ones get a Resume button.
- **▶ Resume all (N)** — resumes every interrupted project from its last completed stage.
- Start/Stop work only from this computer (not from other devices on your network).

## 2b. Manage projects (left panel, project list)

- **Click a project** → selects it; its agents are highlighted in the pyramid, others dimmed.
- **Expand** → per-stage progress bar plus controls:
  - **⏸ Pause** · **▶ Resume** (continues from last checkpoint) · **🔄 Restart** (wipes progress) · **🗑 Delete** (permanent)
  - **Download LaTeX** — appears when the paper is done.
  - **⏭ Skipped: …** — the stages this project skips, and its start layer if not L1. Progress % counts only the stages that run.
- **Manual Intervention Required** — shown when the Sanity Check (S12) fix loop gives up. Check logs, fix, then Resume.

## 2c. Skip stages or layers

Nothing is removed: a skipped stage is marked ⏭ and the project moves on. Choices are saved per project when you submit (`skip_stages` in `project_meta.json`), so they also apply after Pause / Resume / Restart.

- **Skip stages for one project** — in the submit form open **▸ Pipeline stages** and untick stage chips (S1–S22). The checkbox in front of a layer name ticks or unticks all its stages. The badge on the toggle shows how many stages are skipped.
- **Start at a later layer** — set **Start at** (e.g. *L3 · Code & Resources*). All earlier stages are skipped, and boxes appear for the files that layer reads. Paste the text or upload a file with **+**. They are saved to the run folder where the stages look for them:
  | Start at | Files (* = needed) |
  |---|---|
  | L2 Experiment Design | hypotheses.md * |
  | L3 Code & Resources | hypotheses.md *, exp_plan.yaml * |
  | L4 Execution & Refinement | exp_plan.yaml *, experiment/main.py *, hypotheses.md |
  | L5 Paper Writing | analysis.md *, decision.md, experiment_summary.json, hypotheses.md |

  In the Lab modes, a project that skips all of L1 runs as one direction (no parallel angles or discussion).
- **Switch a whole layer off** — the switch on each layer header (next to − / +). An off layer is dimmed and marked **⏭ Off**: new projects skip all its stages and go straight to the next layer's queue. Projects submitted earlier are not affected. The switch is live and resets on restart; to start with layers off, list them under `disabled_layers:` in `config.yaml` (e.g. `[idea, experiment]` or `[L1, L2]`), then `./lab.sh restart-app`.
- **⚠ Warnings** — stages read files written by earlier stages and get empty text when a file is missing. The form lists each skipped stage whose file a later, still-running stage needs (e.g. *S9 is skipped: exp_plan.yaml will be empty for S10–S11, S13, S18*), unless you supplied that file. A ⚠ on a switched-off layer's header shows the same on hover. Supply the file or keep the stage on.
- Skipping S17 Research Decision also skips its PROCEED check, so L4 hands over to L5 directly.

## 3. Watch progress (center)

- **📈 Resources** — live CPU / RAM / GPU usage.
- **Pyramid L1 → L5** — each layer is a team of 🦞 agents; projects flow top to bottom:
  | Layer | Stages |
  |---|---|
  | L1 Research & Ideas | S1–S8: topic → literature → synthesis → *(discussion)* → hypothesis |
  | L2 Experiment Design | S9 |
  | L3 Code & Resources | S10–S13: codebase search, code gen, sanity check, resource plan |
  | L4 Execution & Refinement | S14–S18: run → iterate → analyze → decide (PROCEED / REFINE / PIVOT) → knowledge summary |
  | L5 Paper Writing | S19–S22: outline → draft → peer review → revision |
- Agent card status: **Idle · Working · Awaiting Discussion · Discussing · Done · Error**. Click a layer's header to expand it and see its **📋 Layer Logs**.
- **Stage tracker** (row of icons at the bottom of each agent card): one icon per stage of that layer, for the project the agent is on — ⬜ pending · 🔄 running · ✅ done · ❌ failed · ⏭ skipped · ⏳ waiting · 💬 discussing. Hover an icon for the stage name. The tag on the right is the agent's research angle (e.g. CV).
- **On/off switch** in a layer's header switches that layer off for new projects (see [2c](#2c-skip-stages-or-layers)).
- **+ / −** in a layer's header adds or removes an agent. Each agent handles one project at a time and runs all of that layer's stages itself, so more agents = more projects in parallel, not faster single projects. Only idle agents can be removed. Live changes reset on restart; set lasting counts under `agent_pool:` in `config.yaml`.
- The loop arrow on the right lights up when L4 feeds results back to L1 (REFINE / PIVOT).

## 4. Get results (right panel)

- **📊 Event Log** — every event, all projects; filter by layer.
- **📚 Shared Data Repositories** — outputs grouped by project and stage:
  Idea Store · Experiment Design Store · Code Store · Results Store · Knowledge Base · Paper Store.
  Click an item to preview it; use the download button to save it.

## 5. Talk to the agents (bottom)

- **Ask status:** *"What stage is project X at?"* → system replies with progress, GPU use, etc.
- **Give feedback:** *"Use ResNet-50 as baseline"*, *"Don't download datasets, use /data/imagenet"*.
  Feedback is injected into the next stage's prompt for running projects.
- **Target dropdown** — send to **All** or one layer (e.g. only L3 coders).
- `Enter` sends · `Shift+Enter` new line. The dot in the panel header shows **Connected / Offline**.

## Tips

- LLM provider is **OpenRouter**; all settings are in `config.yaml` (repo root). Put your OpenRouter key in the file named by `secrets_file:` in `config.yaml` (default `~/.config/claw-ai-lab/secrets.env`), then `./lab.sh restart-app`.
- Model preset: set `model_profile: eco | quality | custom` at the top of `config.yaml` (edit `custom:` there for your own mix), or override once with `./lab.sh restart-app quality`. Applies to new projects.
- `./lab.sh fresh` = stop + clear all projects/queues + start (keeps datasets/checkpoints). Old state is moved to `backup/state-<date>/`, not deleted.
- On a Mac with no NVIDIA GPU, keep experiments small. GPU-heavy runs will be slow or fail.
