import { useMemo, useRef, useState } from 'react';
import { ALL_LAYERS } from '../types';
import type { ProjectInfo, Artifact, AgentLayer, CostSummary, PipelineOptions } from '../types';
import { useLocale } from '../i18n';
import {
  START_LAYER_INPUTS, layerStages, skipWarnings, stageRangeLabel, stagesBefore, stagesOfLayers,
} from '../pipeline';

const STATUS_ICONS: Record<string, { color: string; icon: string }> = {
  running:     { color: '#22c55e', icon: '▶' },
  queued:      { color: '#f59e0b', icon: '⏳' },
  completed:   { color: '#3b82f6', icon: '✓' },
  interrupted: { color: '#ef4444', icon: '⏸' },
  new:         { color: '#94a3b8', icon: '○' },
};

type SubmitMode = 'lab' | 'reproduce';
type ReferencePdfUpload = { name: string; contentBase64: string };

function stageName(n: number, t: (k: string) => string): string {
  const key = `stage.${n}`;
  const translated = t(key);
  return translated !== key ? translated : `S${n}`;
}

interface Props {
  projects: ProjectInfo[];
  connected: boolean;
  selectedProjectId: string | null;
  artifactsByProject: Record<string, Artifact[]>;
  discussionMode: boolean;
  /** Layers switched off for new projects (layer header switch / config.yaml) */
  disabledLayers: AgentLayer[];
  modelProfiles: string[];
  activeProfile: string;
  costs: CostSummary | null;
  onToggleDiscussion: () => void;
  onSelect: (projectId: string) => void;
  onResume: (projectId: string) => void;
  onPause: (projectId: string) => void;
  onRestart: (projectId: string) => void;
  onDelete: (projectId: string) => void;
  onQuickSubmit: (
    topic: string,
    mode: SubmitMode,
    researchAngles: string[],
    referencePapers: string,
    referenceFiles: ReferencePdfUpload[],
    paths: { codebases?: string; datasets?: string; checkpoints?: string },
    pipeline: PipelineOptions,
  ) => void;
}

export default function ProjectPanel({ projects, connected, selectedProjectId, artifactsByProject, discussionMode, disabledLayers, modelProfiles, activeProfile, costs, onToggleDiscussion, onSelect, onResume, onPause, onRestart, onDelete, onQuickSubmit }: Props) {
  const [panelOpen, setPanelOpen] = useState(true);
  const [mode, setMode] = useState<SubmitMode>('lab');
  const [topicInput, setTopicInput] = useState('');
  const [anglesInput, setAnglesInput] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refPapersInput, setRefPapersInput] = useState('');
  const [referenceFiles, setReferenceFiles] = useState<Array<ReferencePdfUpload & { key: string }>>([]);
  
  const [showPaths, setShowPaths] = useState(false);
  const [codebasesPath, setCodebasesPath] = useState('');
  const [datasetsPath, setDatasetsPath] = useState('');
  const [checkpointsPath, setCheckpointsPath] = useState('');
  const referenceFileInputRef = useRef<HTMLInputElement | null>(null);
  const { t, locale } = useLocale();

  // ── Pipeline: stages to skip, starting layer, user-supplied inputs ──
  const [showPipeline, setShowPipeline] = useState(false);
  const [modelProfile, setModelProfile] = useState('');  // '' = the active preset
  const [startLayer, setStartLayer] = useState<AgentLayer>('idea');
  const [untickedStages, setUntickedStages] = useState<Set<number>>(new Set());
  const [startInputs, setStartInputs] = useState<Record<string, string>>({});
  const lockedStages = useMemo(
    () => new Set([...stagesOfLayers(disabledLayers), ...stagesBefore(startLayer)]),
    [disabledLayers, startLayer],
  );
  const skipSet = useMemo(() => new Set([...untickedStages, ...lockedStages]), [untickedStages, lockedStages]);
  const inputSpecs = START_LAYER_INPUTS[startLayer];
  const providedFiles = useMemo(
    () => new Set(inputSpecs.filter((sp) => (startInputs[sp.file] || '').trim()).map((sp) => sp.file)),
    [inputSpecs, startInputs],
  );
  const warnings = useMemo(() => skipWarnings(skipSet, providedFiles), [skipSet, providedFiles]);
  const allSkipped = skipSet.size >= 22;

  const toggleStage = (s: number) => {
    setUntickedStages((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };
  const toggleLayerStages = (layer: AgentLayer) => {
    const stages = layerStages(layer).filter((s) => !lockedStages.has(s));
    const allOn = stages.every((s) => !untickedStages.has(s));
    setUntickedStages((prev) => {
      const next = new Set(prev);
      stages.forEach((s) => (allOn ? next.add(s) : next.delete(s)));
      return next;
    });
  };
  const pickInputFile = async (file: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      const text = await f.text();
      setStartInputs((prev) => ({ ...prev, [file]: text }));
    }
    e.target.value = '';
  };
  const resetPipeline = () => {
    setStartLayer('idea');
    setUntickedStages(new Set());
    setStartInputs({});
  };

  const modeInfo: Record<SubmitMode, { label: string; icon: string; placeholder: string; desc: string }> = {
    lab: {
      label: t('project.mode.lab'),
      icon: '🔬',
      placeholder: t('project.placeholder.lab'),
      desc: t('project.mode.lab_desc'),
    },
    reproduce: {
      label: t('project.mode.reproduce'),
      icon: '📄',
      placeholder: t('project.placeholder.reproduce'),
      desc: t('project.mode.reproduce_desc'),
    },
  };

  const info = modeInfo[mode];
  const [showModeHelp, setShowModeHelp] = useState(false);

  const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  };

  const pickReferenceFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter((file) =>
      file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf'
    );
    if (files.length === 0) return;

    const uploads = await Promise.all(files.map(async (file) => ({
      key: `${file.name}:${file.size}:${file.lastModified}`,
      name: file.name,
      contentBase64: arrayBufferToBase64(await file.arrayBuffer()),
    })));

    setReferenceFiles((prev) => {
      const existing = new Set(prev.map((item) => item.key));
      return [...prev, ...uploads.filter((item) => !existing.has(item.key))];
    });
    e.target.value = '';
  };

  const removeReferenceFile = (key: string) => {
    setReferenceFiles((prev) => prev.filter((item) => item.key !== key));
  };

  const submit = () => {
    const text = topicInput.trim();
    if (!text) return;
    const angles = mode === 'lab'
      ? anglesInput.split(/[,，、;；]/).map(s => s.trim()).filter(Boolean)
      : [];
    const paths: { codebases?: string; datasets?: string; checkpoints?: string } = {};
    if (codebasesPath.trim()) paths.codebases = codebasesPath.trim();
    if (datasetsPath.trim()) paths.datasets = datasetsPath.trim();
    if (checkpointsPath.trim()) paths.checkpoints = checkpointsPath.trim();
    onQuickSubmit(
      text,
      mode,
      angles,
      refPapersInput.trim(),
      referenceFiles.map(({ name, contentBase64 }) => ({ name, contentBase64 })),
      paths,
      {
        modelProfile,
        skipStages: [...skipSet].sort((a, b) => a - b),
        startLayer,
        startInputs: Object.fromEntries(
          inputSpecs.filter((sp) => (startInputs[sp.file] || '').trim()).map((sp) => [sp.file, startInputs[sp.file]]),
        ),
      },
    );
    setTopicInput('');
    setAnglesInput('');
    setRefPapersInput('');
    setReferenceFiles([]);
    setStartInputs({});
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };

  const sorted = [...projects].sort((a, b) => {
    const o: Record<string, number> = { running: 0, queued: 1, interrupted: 2, new: 3, completed: 4 };
    return (o[a.status] ?? 5) - (o[b.status] ?? 5);
  });

  const running = projects.filter(p => p.status === 'running').length;
  const interrupted = projects.filter(p => p.status === 'interrupted').length;

  const goLabel = t('project.go_submit');

  const toggleExpand = (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedId(prev => prev === projectId ? null : projectId);
  };

  return (
    <div className="project-panel">
      <div className="project-panel-header" onClick={() => setPanelOpen(!panelOpen)}>
        <h3>
          <span className="panel-icon">📋</span> {t('project.title')}
          {projects.length > 0 && <span className="project-count">{projects.length}</span>}
          {running > 0 && <span className="project-count running-count">{t('project.count_running', { n: running })}</span>}
          {interrupted > 0 && <span className="project-count interrupted-count">{t('project.count_interrupted', { n: interrupted })}</span>}
        </h3>
        <span className="expand-arrow">{panelOpen ? '▾' : '▸'}</span>
      </div>

      {panelOpen && (
        <div className="project-panel-body">
          <div className="submit-section">
            <div className="mode-row">
              <div className="mode-selector">
                <button
                  className={`mode-btn ${mode === 'lab' && discussionMode ? 'active' : ''}`}
                  onClick={() => { setMode('lab'); if (!discussionMode) onToggleDiscussion(); }}
                  title={t('discussion.hint_on')}
                >
                  🔬 {t('project.mode.lab_discuss')}
                </button>
                <button
                  className={`mode-btn ${mode === 'lab' && !discussionMode ? 'active' : ''}`}
                  onClick={() => { setMode('lab'); if (discussionMode) onToggleDiscussion(); }}
                  title={t('discussion.hint_off')}
                >
                  🔬 {t('project.mode.lab_independent')}
                </button>
                <button
                  className={`mode-btn ${mode === 'reproduce' ? 'active' : ''}`}
                  onClick={() => setMode('reproduce')}
                >
                  📄 {modeInfo.reproduce.label}
                </button>
              </div>
              <div className="mode-help-wrapper">
                <button className="mode-info-btn" type="button" onClick={() => setShowModeHelp(!showModeHelp)}>?</button>
                {showModeHelp && (
                  <div className="mode-help-popup">
                    {t('project.mode.help')}
                  </div>
                )}
              </div>
            </div>

            <div className="project-input-stack">
              <textarea
                className="project-topic-input"
                placeholder={info.placeholder}
                value={topicInput}
                onChange={e => setTopicInput(e.target.value)}
                onKeyDown={onKey}
                rows={2}
                disabled={!connected}
              />
              {mode === 'lab' && (
                <div className="project-angles-row">
                  <input
                    className="project-angles-input"
                    placeholder={t('project.angles_placeholder')}
                    value={anglesInput}
                    onChange={e => setAnglesInput(e.target.value)}
                    onKeyDown={onKey}
                    disabled={!connected}
                  />
                </div>
              )}
              <div className="project-ref-papers-toggle">
                <button
                  className="ref-papers-toggle-btn"
                  type="button"
                  onClick={() => setShowPaths(!showPaths)}
                >
                  {showPaths ? '▾' : '▸'} {t('paths.toggle')}
                  {(refPapersInput.trim() || referenceFiles.length > 0 || codebasesPath.trim() || datasetsPath.trim() || checkpointsPath.trim()) && (
                    <span className="ref-badge">
                      {[
                        refPapersInput.trim() || referenceFiles.length > 0 ? 'refs' : '',
                        codebasesPath,
                        datasetsPath,
                        checkpointsPath,
                      ].filter(s => s.trim()).length}
                    </span>
                  )}
                </button>
              </div>
              {showPaths && (
                <div className="paths-grid">
                  <label className="path-field">
                    <span className="path-label">{t('project.ref_papers_label')}</span>
                    <div className="path-input-with-action">
                      <input
                        className="path-input"
                        placeholder={t('project.ref_papers_placeholder')}
                        value={refPapersInput}
                        onChange={e => setRefPapersInput(e.target.value)}
                        disabled={!connected}
                      />
                      <button
                        className="path-action-btn"
                        type="button"
                        title={t('project.ref_papers_pick_pdf')}
                        onClick={() => referenceFileInputRef.current?.click()}
                        disabled={!connected}
                      >
                        +
                      </button>
                      <input
                        ref={referenceFileInputRef}
                        className="hidden-file-input"
                        type="file"
                        accept=".pdf,application/pdf"
                        multiple
                        onChange={(e) => { void pickReferenceFiles(e); }}
                        disabled={!connected}
                      />
                    </div>
                    {referenceFiles.length > 0 && (
                      <div className="selected-file-list">
                        {referenceFiles.map((file) => (
                          <span key={file.key} className="selected-file-chip">
                            <span className="selected-file-name">{file.name}</span>
                            <button
                              className="selected-file-remove"
                              type="button"
                              title={t('project.ref_papers_remove_pdf')}
                              onClick={() => removeReferenceFile(file.key)}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </label>
                  <label className="path-field">
                    <span className="path-label">{t('paths.codebases')}</span>
                    <input
                      className="path-input"
                      placeholder={t('paths.codebases_placeholder')}
                      value={codebasesPath}
                      onChange={e => setCodebasesPath(e.target.value)}
                      disabled={!connected}
                    />
                  </label>
                  <label className="path-field">
                    <span className="path-label">{t('paths.datasets')}</span>
                    <input
                      className="path-input"
                      placeholder={t('paths.datasets_placeholder')}
                      value={datasetsPath}
                      onChange={e => setDatasetsPath(e.target.value)}
                      disabled={!connected}
                    />
                  </label>
                  <label className="path-field">
                    <span className="path-label">{t('paths.checkpoints')}</span>
                    <input
                      className="path-input"
                      placeholder={t('paths.checkpoints_placeholder')}
                      value={checkpointsPath}
                      onChange={e => setCheckpointsPath(e.target.value)}
                      disabled={!connected}
                    />
                  </label>
                </div>
              )}
              <div className="project-ref-papers-toggle">
                <button
                  className="ref-papers-toggle-btn"
                  type="button"
                  onClick={() => setShowPipeline(!showPipeline)}
                >
                  {showPipeline ? '▾' : '▸'} {t('pipeline.toggle')}
                  {skipSet.size > 0 && (
                    <span className="ref-badge" title={t('pipeline.skipped_badge', { stages: stageRangeLabel([...skipSet]) })}>
                      ⏭{skipSet.size}
                    </span>
                  )}
                  {warnings.length > 0 && <span className="pipeline-warn-badge">⚠{warnings.length}</span>}
                </button>
              </div>
              {showPipeline && (
                <div className="pipeline-section">
                  <label className="pipeline-start-row">
                    <span className="path-label">{t('pipeline.start_at')}</span>
                    <select
                      className="pipeline-start-select"
                      value={startLayer}
                      onChange={(e) => setStartLayer(e.target.value as AgentLayer)}
                      disabled={!connected}
                    >
                      {ALL_LAYERS.map((l) => (
                        <option key={l} value={l}>{t(`layer.${l}.name`)}</option>
                      ))}
                    </select>
                  </label>
                  <div className="pipeline-hint">{t('pipeline.hint')}</div>

                  {ALL_LAYERS.map((layer) => {
                    const stages = layerStages(layer);
                    const off = disabledLayers.includes(layer);
                    const beforeStart = ALL_LAYERS.indexOf(layer) < ALL_LAYERS.indexOf(startLayer);
                    const ticked = stages.filter((s) => !skipSet.has(s)).length;
                    return (
                      <div key={layer} className={`pipeline-layer${ticked === 0 ? ' all-skipped' : ''}`}>
                        <label className="pipeline-layer-name" title={t('pipeline.layer_toggle_hint')}>
                          <input
                            type="checkbox"
                            checked={ticked === stages.length}
                            ref={(el) => { if (el) el.indeterminate = ticked > 0 && ticked < stages.length; }}
                            aria-label={t(`layer.${layer}.name`)}
                            onChange={() => toggleLayerStages(layer)}
                            disabled={!connected || off || beforeStart}
                          />
                          <span>{t(`layer.${layer}.name`)}</span>
                          {off && <span className="pipeline-layer-note">{t('pipeline.layer_off')}</span>}
                          {!off && beforeStart && <span className="pipeline-layer-note">{t('pipeline.before_start')}</span>}
                        </label>
                        <div className="pipeline-stage-chips">
                          {stages.map((s) => {
                            const locked = lockedStages.has(s);
                            const on = !skipSet.has(s);
                            return (
                              <label
                                key={s}
                                className={`pipeline-stage-chip${on ? ' on' : ''}${locked ? ' locked' : ''}`}
                                title={`S${s} ${t(`stage.${s}`)}${on ? '' : ` — ${t('pipeline.skipped')}`}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={on}
                                  aria-label={`S${s} ${t(`stage.${s}`)}`}
                                  onChange={() => toggleStage(s)}
                                  disabled={!connected || locked}
                                />
                                {on ? '' : '⏭ '}S{s}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  {inputSpecs.length > 0 && (
                    <div className="pipeline-inputs">
                      <div className="path-label">{t('pipeline.inputs_title', { layer: t(`layer.${startLayer}.name`) })}</div>
                      {inputSpecs.map((sp) => (
                        <div key={sp.file} className="path-field">
                          <span className="path-label">
                            {sp.file}{sp.required ? ' *' : ''}
                            <span className="pipeline-input-desc"> — {t(`pipeline.input.${sp.file}`)}</span>
                          </span>
                          <div className="path-input-with-action">
                            <textarea
                              className="path-input pipeline-input-text"
                              rows={3}
                              placeholder={t('pipeline.input_placeholder')}
                              value={startInputs[sp.file] || ''}
                              onChange={(e) => setStartInputs((prev) => ({ ...prev, [sp.file]: e.target.value }))}
                              disabled={!connected}
                            />
                            <label className="path-action-btn pipeline-upload-btn" title={t('pipeline.upload')}>
                              +
                              <input
                                className="hidden-file-input"
                                type="file"
                                onChange={(e) => { void pickInputFile(sp.file, e); }}
                                disabled={!connected}
                              />
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {(warnings.length > 0 || allSkipped) && (
                    <div className="pipeline-warnings">
                      {allSkipped && <div>⚠ {t('pipeline.all_skipped')}</div>}
                      {warnings.map((w) => (
                        <div key={`${w.producer}:${w.file}`}>
                          ⚠ {t('skip.warn_line', { file: w.file, producer: `S${w.producer}`, consumers: stageRangeLabel(w.consumers) })}
                        </div>
                      ))}
                      {warnings.length > 0 && <div className="pipeline-warn-foot">{t('pipeline.warn_foot')}</div>}
                    </div>
                  )}
                  {(untickedStages.size > 0 || startLayer !== 'idea') && (
                    <button className="ref-papers-toggle-btn" type="button" onClick={resetPipeline}>
                      ↺ {t('pipeline.reset')}
                    </button>
                  )}
                </div>
              )}
              {modelProfiles.length > 0 && (
                <label className="pipeline-start-row" title={t('models.hint')}>
                  <span className="path-label">{t('models.label')}</span>
                  <select
                    className="pipeline-start-select"
                    value={modelProfile || activeProfile}
                    onChange={(e) => setModelProfile(e.target.value)}
                    disabled={!connected}
                  >
                    {modelProfiles.map((p) => (
                      <option key={p} value={p}>{p}{p === activeProfile ? ` (${t('models.default')})` : ''}</option>
                    ))}
                  </select>
                </label>
              )}
              <button
                className={`project-go-btn ${mode === 'lab' ? 'lab-mode' : 'reproduce-mode'}`}
                onClick={submit}
                disabled={!connected || !topicInput.trim()}
              >
                {goLabel}
              </button>
            </div>
          </div>

          {sorted.length > 0 && <div className="panel-divider" />}

          {sorted.length === 0 ? (
            <div className="project-empty">
              {mode === 'lab' ? t('project.empty_lab') : t('project.empty_reproduce')}
            </div>
          ) : (
            <div className="project-list-inner">
              {sorted.map(proj => {
                const cfg = STATUS_ICONS[proj.status] || STATUS_ICONS.new;
                const statusLabel = t(`project.status.${proj.status}`);
                const fs = proj.firstStage || 1;
                const completedCount = proj.completedStages ?? (proj.lastCompletedStage >= fs ? proj.lastCompletedStage - fs + 1 : 0);
                const pct = proj.totalStages > 0
                  ? Math.round((completedCount / proj.totalStages) * 100)
                  : proj.status === 'completed' ? 100 : 0;
                const isSelected = selectedProjectId === proj.projectId;
                const isExpanded = expandedId === proj.projectId;
                const arts = artifactsByProject[proj.projectId] || [];
                const cost = costs?.projects[proj.projectId];

                return (
                  <div
                    key={proj.projectId}
                    className={`project-card project-${proj.status}${isSelected ? ' selected' : ''}${isExpanded ? ' expanded' : ''}`}
                  >
                    <div className="project-summary" onClick={(e) => { onSelect(proj.projectId); toggleExpand(proj.projectId, e); }}>
                      <span className="project-status-dot" style={{ background: cfg.color }} title={statusLabel}>{cfg.icon}</span>
                      <span className="project-summary-name" title={proj.topic || proj.projectId}>
                        {proj.topic || proj.projectId}
                      </span>
                      <span className="project-summary-progress">{pct}%</span>
                      {cost && <span className="project-summary-arts" title={t('cost.project_title')}>${cost.total.toFixed(2)}</span>}
                      {arts.length > 0 && <span className="project-summary-arts">📦{arts.length}</span>}
                      {proj.intervention && <span className="project-intervention-icon" title={t('project.intervention_needed')}>⚠</span>}
                      <span className={`project-expand-arrow${isExpanded ? ' open' : ''}`}>▸</span>
                    </div>

                    {/* Mini progress bar */}
                    <div className="project-mini-bar" onClick={(e) => toggleExpand(proj.projectId, e)}>
                      <div className="project-mini-fill" style={{ width: `${pct}%`, background: cfg.color }} />
                    </div>

                    {isExpanded && (
                      <div className="project-detail">
                        <div className="project-detail-meta">
                          <span className="project-id-label" title={proj.projectId}>{proj.projectId}</span>
                          <span className="project-status-badge" style={{ background: cfg.color }}>
                            {cfg.icon} {statusLabel}
                          </span>
                        </div>

                        <div className="project-detail-stage">
                          {completedCount}/{proj.totalStages} {t('project.stages_label')}
                          {proj.lastCompletedStage > 0 && (
                            <> · {stageName(proj.lastCompletedStage, t)}
                              {completedCount < proj.totalStages && (
                                <span className="project-next-stage"> → {stageName(proj.lastCompletedStage + 1, t)}</span>
                              )}
                            </>
                          )}
                        </div>

                        {(proj.modelProfile || proj.mode) && (
                          <div className="project-detail-stage" title={t('models.locked_hint')}>
                            🔒 {[proj.modelProfile, proj.mode && t(`models.mode.${proj.mode}`)].filter(Boolean).join(' · ')}
                          </div>
                        )}

                        {cost && (
                          <div className="project-detail-stage" title={t('cost.project_title')}>
                            💰 ${cost.total.toFixed(3)}
                            {ALL_LAYERS.filter((l) => cost.layers[l]).map((l) => (
                              <span key={l}> · L{ALL_LAYERS.indexOf(l) + 1} ${cost.layers[l].toFixed(3)}</span>
                            ))}
                          </div>
                        )}

                        {proj.skippedStages && proj.skippedStages.length > 0 && (
                          <div className="project-detail-stage" title={t('pipeline.skipped')}>
                            ⏭ {t('pipeline.skipped_badge', { stages: stageRangeLabel(proj.skippedStages) })}
                            {proj.startLayer && proj.startLayer !== 'idea' && (
                              <> · {t('pipeline.started_at', { layer: t(`layer.${proj.startLayer}.name`) })}</>
                            )}
                          </div>
                        )}

                        {proj.timestamp && (
                          <div className="project-detail-time">
                            {new Date(proj.timestamp).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}
                          </div>
                        )}

                        {/* Artifacts by repo — hidden for now */}

                        {proj.intervention && (
                          <div className="project-intervention-box">
                            <div className="project-intervention-title">⚠ {t('project.intervention_needed')}</div>
                            <pre className="project-intervention-detail">{proj.intervention}</pre>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="project-detail-actions">
                          {proj.status === 'interrupted' && connected && (
                            <button className="project-resume-btn" onClick={(e) => { e.stopPropagation(); onResume(proj.projectId); }}>
                              {t('project.resume')}
                            </button>
                          )}
                          {(proj.status === 'running' || proj.status === 'queued') && connected && (
                            <button className="project-pause-btn" onClick={(e) => { e.stopPropagation(); onPause(proj.projectId); }}>
                              {t('project.pause')}
                            </button>
                          )}
                          {connected && (
                            <button className="project-restart-btn" onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(t('project.restart_confirm', { id: proj.projectId }))) {
                                onRestart(proj.projectId);
                              }
                            }}>
                              {t('project.restart')}
                            </button>
                          )}
                          <button
                            className="project-delete-btn"
                            title={t('project.delete_title')}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(t('project.delete_confirm', { id: proj.projectId }))) {
                                onDelete(proj.projectId);
                              }
                            }}
                          >
                            {t('project.delete')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
