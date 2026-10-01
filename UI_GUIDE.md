# Claw AI Lab — UI Guide

Open **http://localhost:5903/** after `./start.sh`.

```
┌──────────────────────────── Header: stats · ☀️/🌙 theme · 中文/EN ───────────────────────────┐
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
6. Click the submit button (**3 Angles Auto-explore**, **N Angles Parallel**, or **Start Reproduce**).

## 2. Manage projects (left panel, project list)

- **Click a project** → selects it; its agents are highlighted in the pyramid, others dimmed.
- **Expand** → per-stage progress bar plus controls:
  - **⏸ Pause** · **▶ Resume** (continues from last checkpoint) · **🔄 Restart** (wipes progress) · **🗑 Delete** (permanent)
  - **Download LaTeX** — appears when the paper is done.
- **Manual Intervention Required** — shown when the Sanity Check (S12) fix loop gives up. Check logs, fix, then Resume.

## 3. Watch progress (center)

- **📈 Resources** — live CPU / RAM / GPU usage.
- **Pyramid L1 → L5** — each layer is a team of 🦞 agents; projects flow top to bottom:
  | Layer | Stages |
  |---|---|
  | L1 Research & Ideas | S1–S8: topic → literature → synthesis → *(discussion)* → hypothesis |
  | L2 Experiment Design | S9 |
  | L3 Code & Resources | S10–S13: codebase search, code gen, sanity check, resource plan |
  | L4 Execution & Refinement | S14–S17: run → iterate → analyze → decide (PROCEED / REFINE / PIVOT) |
  | L5 Paper Writing | S18–S22: outline → draft → peer review → revision |
- Agent card status: **Idle · Working · Awaiting Discussion · Discussing · Done · Error**. Click a layer's header to expand it and see its **📋 Layer Logs**.
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

- LLM provider is **OpenRouter**; all settings are in `config.yaml` (repo root). Put your OpenRouter key in `~/.config/claw-ai-lab/secrets.env`, then `./start.sh restart`.
- Model preset: set `model_profile: eco | quality | custom` at the top of `config.yaml` (edit `custom:` there for your own mix), or override once with `./start.sh restart quality`. Applies to new projects.
- `./start.sh fresh` = stop + wipe all projects/queues + start (keeps datasets/checkpoints).
- On a Mac with no NVIDIA GPU, keep experiments small. GPU-heavy runs will be slow or fail.
