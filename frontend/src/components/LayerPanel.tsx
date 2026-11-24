import { memo, useState } from 'react';
import { LAYER_META, STAGE_META } from '../types';
import type { LobsterAgent, LogEntry, AgentLayer } from '../types';
import { useLocale } from '../i18n';
import { layerStages, skipWarnings, stagesOfLayers, stageRangeLabel } from '../pipeline';

interface Props {
  layer: AgentLayer;
  agents: LobsterAgent[];
  logs: LogEntry[];
  tierIndex: number;
  selectedProjectId?: string | null;
  connected?: boolean;
  onAddAgent?: (layer: AgentLayer) => void;
  onRemoveAgent?: (agentId: string) => void;
  /** Layer switched off for new projects */
  disabled?: boolean;
  disabledLayers?: AgentLayer[];
  onToggleLayer?: (layer: AgentLayer, enabled: boolean) => void;
}

const STATUS_ICON: Record<string, string> = {
  idle: '🦞', working: '🔬', error: '❗', done: '✅',
  waiting_discussion: '🗣️', discussing: '🗣️',
};
const STAGE_ST: Record<string, string> = {
  pending: '⬜', running: '🔄', completed: '✅', failed: '❌', skipped: '⏭',
  waiting: '⏳', discussing: '💬',
};
const DISCUSSION_STAGE = 100;

export default memo(function LayerPanel({ layer, agents, logs, selectedProjectId, connected, onAddAgent, onRemoveAgent, disabled, disabledLayers, onToggleLayer }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { t, locale } = useLocale();
  const meta = LAYER_META[layer];
  const layerName = t(`layer.${layer}.name`);
  const discussionLabel = `💬${t('stage.100')}`;
  const recentLogs = logs.slice(-30);
  const widthPercent = Math.min(100, agents.length * 18 + 20);
  const workingCount = agents.filter((a) => ['working', 'waiting_discussion', 'discussing'].includes(a.status)).length;
  // Only idle agents can be removed; keep at least one per layer
  const removable = [...agents].reverse().find((a) => a.status === 'idle');
  const canRemove = !!removable && agents.length > 1;
  // Switched off: which still-running stages read files this layer would have written
  const ownStages = new Set(layerStages(layer));
  const offWarnings = disabled
    ? skipWarnings(new Set(stagesOfLayers(disabledLayers || []))).filter((w) => ownStages.has(w.producer))
    : [];
  const offWarningText = offWarnings
    .map((w) => t('skip.warn_line', { file: w.file, producer: `S${w.producer}`, consumers: stageRangeLabel(w.consumers) }))
    .join('\n');

  return (
    <div
      className={`layer-panel${disabled ? ' layer-disabled' : ''}`}
      style={{ '--layer-color': meta.color, width: `${widthPercent}%`, maxWidth: '100%' } as React.CSSProperties}
    >
      <div className="layer-header" onClick={() => setExpanded(!expanded)}>
        <div className="layer-title-row">
          <span className="layer-dot" />
          <h3>{layerName}</h3>
          <span className="layer-agent-count">
            {agents.length} 🦞 · {workingCount} {t('layer.active')}
          </span>
          {disabled && <span className="layer-off-badge" title={t('layer.off_hint')}>⏭ {t('layer.off')}</span>}
          {offWarnings.length > 0 && (
            <span className="layer-off-warning" title={`${t('layer.off_warning')}\n${offWarningText}`}>⚠</span>
          )}
          {connected && onToggleLayer && (
            <span className="layer-agent-controls" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                role="switch"
                aria-checked={!disabled}
                className={`layer-switch${disabled ? '' : ' on'}`}
                title={disabled ? t('layer.switch_on') : t('layer.switch_off')}
                onClick={() => onToggleLayer(layer, !!disabled)}
              >
                <span className="layer-switch-knob" />
              </button>
            </span>
          )}
          {connected && onAddAgent && onRemoveAgent && (
            <span className="layer-agent-controls" onClick={(e) => e.stopPropagation()}>
              <button
                className="layer-agent-btn"
                disabled={!canRemove}
                title={canRemove ? t('layer.remove_agent') : t('layer.remove_none_idle')}
                onClick={() => removable && onRemoveAgent(removable.id)}
              >−</button>
              <button
                className="layer-agent-btn"
                title={t('layer.add_agent')}
                onClick={() => onAddAgent(layer)}
              >+</button>
            </span>
          )}
          <span className={`expand-icon ${expanded ? 'open' : ''}`}>▼</span>
        </div>
        <div className="layer-stages-bar">
          {meta.stages.map((s) => {
            const sm = STAGE_META[s];
            if (!sm) return null;
            const isDisc = s === DISCUSSION_STAGE;
            const anyRunning = isDisc
              ? agents.some((a) => a.status === 'waiting_discussion' || a.status === 'discussing')
              : agents.some((a) => a.currentStage === s);
            const anyDone = isDisc
              ? agents.some((a) => a.stageProgress[DISCUSSION_STAGE] === 'completed')
              : agents.some((a) => a.stageProgress[s] === 'completed');
            const cls = disabled ? 'stage-skipped' : anyRunning ? 'stage-running' : anyDone ? 'stage-done' : 'stage-idle';
            const dn = sm.displayNumber;
            const sName = t(`stage.${s}`);
            const label = isDisc ? `💬 ${sName}` : `S${dn} ${sName}`;
            return (
              <span key={s} className={`stage-chip ${cls}${isDisc ? ' stage-discussion' : ''}`} title={sm.key}>
                {label}
              </span>
            );
          })}
        </div>
      </div>

      <div className="agent-row">
        {agents.map((agent) => {
          const dimmed = selectedProjectId && agent.projectId && agent.projectId !== selectedProjectId;
          const highlighted = selectedProjectId && agent.projectId === selectedProjectId;
          const statusLabel = t(`layer.agent_status.${agent.status}`);
          return (
          <div key={agent.id} className={`agent-card status-${agent.status}${highlighted ? ' agent-highlighted' : ''}${dimmed ? ' agent-dimmed' : ''}`}>
            <div className="agent-card-top">
              <span className="agent-icon">{STATUS_ICON[agent.status] || '🦞'}</span>
              <span className="agent-name" title={agent.name}>{agent.name}</span>
              <span className="agent-run-id" title={agent.runId || ''}>{agent.runId}</span>
            </div>
            <div className="agent-status">
              <span className={`status-dot ${agent.status}`} />
              {statusLabel}
              {agent.currentStage && (
                <span className={`agent-stage-badge${agent.currentStage === DISCUSSION_STAGE ? ' discussion-badge' : ''}`}>
                  {agent.currentStage === DISCUSSION_STAGE
                    ? discussionLabel
                    : `S${STAGE_META[agent.currentStage]?.displayNumber ?? agent.currentStage}`}
                </span>
              )}
              {!agent.currentStage && (agent.status === 'waiting_discussion' || agent.status === 'discussing') && (
                <span className="agent-stage-badge discussion-badge">{discussionLabel}</span>
              )}
            </div>
            {agent.currentTask && <div className="agent-task" title={agent.currentTask}>{agent.currentTask}</div>}
            <div className="agent-bottom-row">
              <div className="agent-progress">
                {LAYER_META[layer].stages.map((s) => {
                  const isDisc = s === DISCUSSION_STAGE;
                  const status = isDisc
                    ? (agent.status === 'discussing' ? 'discussing'
                      : agent.status === 'waiting_discussion' ? 'waiting'
                      : agent.stageProgress[s] || 'pending')
                    : (agent.stageProgress[s] || 'pending');
                  const dn2 = STAGE_META[s]?.displayNumber ?? s;
                  const sName = t(`stage.${s}`);
                  const label = isDisc ? `💬 S${dn2} ${sName}: ${status}` : `S${dn2}: ${status}`;
                  return (
                    <span key={s} className="stage-pip" title={label}>
                      {STAGE_ST[status] || '⬜'}
                    </span>
                  );
                })}
              </div>
              {agent.roleTag && <span className="agent-role-tag" title={agent.roleTag}>{agent.roleTag}</span>}
            </div>
          </div>
          );
        })}
      </div>

      {expanded && (
        <div className="layer-logs">
          <div className="log-title">{t('layer.log_title')} ({recentLogs.length})</div>
          <div className="log-list">
            {recentLogs.length === 0 && <div className="log-empty">{t('layer.no_logs')}</div>}
            {recentLogs.map((log) => (
              <div key={log.id} className={`log-item level-${log.level}`}>
                <span className="log-time">{new Date(log.timestamp).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US')}</span>
                <span className="log-agent">{log.agentName.slice(0, 12)}</span>
                {log.stage && <span className={`log-stage${log.stage === DISCUSSION_STAGE ? ' log-stage-discussion' : ''}`}>
                  {log.stage === DISCUSSION_STAGE
                    ? discussionLabel
                    : `S${STAGE_META[log.stage]?.displayNumber ?? log.stage}`}
                </span>}
                <span className="log-msg">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
