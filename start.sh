#!/bin/bash
# 🦞 Lobster Agent Legion — one-command start/stop
# Usage: ./start.sh [start|stop|restart|status|reset-state|fresh] [eco|quality|custom]
#   eco|quality|custom — model preset (default: `model_profile:` in config.yaml)
#
# reset-state — clear persisted pipeline data (projects, queues, Idea factory output, shared knowledge-base index)
#               Run stop first; otherwise agent_bridge may write files back.
# fresh       — stop → reset-state → start (fresh run from scratch)

BASE="$(cd "$(dirname "$0")" && pwd)"
FE="$BASE/frontend"
LOG="$BASE/logs"
PIDF="$BASE/.pids"
RUNTIME_PORTS="$BASE/.runtime_ports"

# Load API keys from a private file outside the repo (override path with CLAW_SECRETS_FILE)
SECRETS_FILE="${CLAW_SECRETS_FILE:-$HOME/.config/claw-ai-lab/secrets.env}"
if [ -f "$SECRETS_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$SECRETS_FILE"
    set +a
fi

# Resolve python path: env PYTHON_PATH > config sandbox.python_path > system python3
_cfg_py=""
for _cfg in "$BASE/config.yaml" "$BASE"/backend/runs/project_configs/*.yaml; do
    [ -f "$_cfg" ] || continue
    _cfg_py=$(grep 'python_path:' "$_cfg" 2>/dev/null | head -1 | sed 's/.*python_path:[[:space:]]*"\{0,1\}\([^"]*\)"\{0,1\}/\1/' | tr -d '[:space:]')
    [ -n "$_cfg_py" ] && [ -x "$_cfg_py" ] && break
    _cfg_py=""
done
PY="${PYTHON_PATH:-${_cfg_py:-python3}}"

# Ports passed on the command line take precedence over .runtime_ports (so a stale file can't override them)
_saved_rm="${RESOURCE_MONITOR_PORT-}"
_saved_ab="${AGENT_BRIDGE_PORT-}"
_saved_fe="${FRONTEND_PORT-}"
if [ -f "$RUNTIME_PORTS" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$RUNTIME_PORTS"
    set +a
fi
[ -n "$_saved_rm" ] && RESOURCE_MONITOR_PORT="$_saved_rm"
[ -n "$_saved_ab" ] && AGENT_BRIDGE_PORT="$_saved_ab"
[ -n "$_saved_fe" ] && FRONTEND_PORT="$_saved_fe"

# If ports clash with another Claw-AI-Lab / PyramidResearchTeam copy on this machine, override them, e.g.:
#   RESOURCE_MONITOR_PORT=8915 AGENT_BRIDGE_PORT=8916 FRONTEND_PORT=5913 ./start.sh
RESOURCE_MONITOR_PORT="${RESOURCE_MONITOR_PORT:-8905}"
AGENT_BRIDGE_PORT="${AGENT_BRIDGE_PORT:-8906}"
FRONTEND_PORT="${FRONTEND_PORT:-5903}"
export RESOURCE_MONITOR_PORT AGENT_BRIDGE_PORT

# API key comes from the secrets file above (or llm.api_key in the config yaml).
export RESEARCHCLAW_API_KEY="${RESEARCHCLAW_API_KEY:-}"

# Model preset: 2nd arg > $MODEL_PROFILE > `model_profile:` in config.yaml
PROFILE_FILE_ACTIVE="$(sed -n 's/^model_profile:[[:space:]]*"\{0,1\}\([A-Za-z0-9_-]*\).*/\1/p' "$BASE/config.yaml" 2>/dev/null)"
MODEL_PROFILE="${2:-${MODEL_PROFILE:-$PROFILE_FILE_ACTIVE}}"
export MODEL_PROFILE

FNM_DIR="${FNM_DIR:-$HOME/.local/share/fnm}"
export PATH="$FNM_DIR:$PATH"
eval "$($FNM_DIR/fnm env 2>/dev/null)" 2>/dev/null

mkdir -p "$LOG" "$PIDF"

# Ascend NPU CANN environment (no-op if not installed)
source /usr/local/Ascend/ascend-toolkit/set_env.sh 2>/dev/null

G='\033[0;32m'; R='\033[0;31m'; Y='\033[0;33m'; N='\033[0m'

IDEA_COUNT=0
IDEA_TOPIC=""
IDEA_CONFIG=""

is_port_listening() {
    local port="$1"
    if command -v ss >/dev/null 2>&1; then
        ss -tln 2>/dev/null | awk -v p=":$port" '$4 ~ p"$" {found=1} END {exit(found?0:1)}'
        return $?
    fi
    if command -v lsof >/dev/null 2>&1; then
        lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
        return $?
    fi
    if command -v netstat >/dev/null 2>&1; then
        netstat -an 2>/dev/null | grep -E "[\.\:]$port[[:space:]].*LISTEN" >/dev/null
        return $?
    fi
    return 1
}

do_start() {
    echo "🦞 Starting the Lobster Agent Legion..."
    echo ""

    # 1) Resource Monitor
    if is_port_listening "$RESOURCE_MONITOR_PORT"; then
        echo -e "  ${Y}⏭ resource_monitor already running (port ${RESOURCE_MONITOR_PORT})${N}"
    else
        nohup $PY -u "$BASE/backend/services/resource_monitor.py" --port "$RESOURCE_MONITOR_PORT" \
            > "$LOG/resource_monitor.log" 2>&1 &
        echo $! > "$PIDF/resource_monitor.pid"
        sleep 1
        echo -e "  ${G}✅ resource_monitor (PID=$!)${N}"
    fi

    # 2) Agent Bridge
    if is_port_listening "$AGENT_BRIDGE_PORT"; then
        echo -e "  ${Y}⏭ agent_bridge already running (port ${AGENT_BRIDGE_PORT})${N}"
    else
        nohup $PY -u "$BASE/backend/services/agent_bridge.py" \
            --port "$AGENT_BRIDGE_PORT" --python "$PY" \
            --agent-dir "$BASE/backend/agent" \
            --runs-dir "$BASE/backend/runs" \
            --pool-idea 3 --pool-exp 2 --pool-code 3 --pool-exec 4 --pool-write 2 \
            --total-gpus 8 --gpus-per-project 1 \
            --discussion-mode --discussion-rounds 2 \
            ${AUTO_LOOP:+--auto-loop} \
            ${IDEA_COUNT:+--idea-count $IDEA_COUNT} \
            ${IDEA_TOPIC:+--idea-topic "$IDEA_TOPIC"} \
            ${IDEA_CONFIG:+--idea-config "$IDEA_CONFIG"} \
            > "$LOG/agent_bridge.log" 2>&1 &
        echo $! > "$PIDF/agent_bridge.pid"
        sleep 1
        echo -e "  ${G}✅ agent_bridge (PID=$!)${N}"
    fi

    # 3) Frontend Vite
    if is_port_listening "$FRONTEND_PORT"; then
        echo -e "  ${Y}⏭ frontend already running (port ${FRONTEND_PORT})${N}"
    else
        cd "$FE"
        nohup env RESOURCE_MONITOR_PORT="$RESOURCE_MONITOR_PORT" AGENT_BRIDGE_PORT="$AGENT_BRIDGE_PORT" \
            npx vite --host 0.0.0.0 --port "$FRONTEND_PORT" \
            > "$LOG/frontend.log" 2>&1 &
        echo $! > "$PIDF/frontend.pid"
        sleep 2
        echo -e "  ${G}✅ frontend (PID=$!)${N}"
        cd "$BASE"
    fi

    echo ""
    echo "🧠 Model profile: ${MODEL_PROFILE} (config.yaml)"
    echo "📍 Service addresses:"
    echo -e "   ${G}Frontend UI:  http://localhost:${FRONTEND_PORT}/${N}"
    echo "   Resource WS:  ws://localhost:${RESOURCE_MONITOR_PORT}"
    echo "   Agent Bridge: ws://localhost:${AGENT_BRIDGE_PORT}"
    echo ""
    printf 'RESOURCE_MONITOR_PORT=%s\nAGENT_BRIDGE_PORT=%s\nFRONTEND_PORT=%s\n' \
        "$RESOURCE_MONITOR_PORT" "$AGENT_BRIDGE_PORT" "$FRONTEND_PORT" > "$RUNTIME_PORTS"
}

do_stop() {
    echo "🛑 Stopping all services..."
    for svc in frontend agent_bridge resource_monitor; do
        f="$PIDF/$svc.pid"
        if [ -f "$f" ]; then
            pid=$(cat "$f")
            kill "$pid" 2>/dev/null && sleep 0.5
            kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
            rm -f "$f"
            echo -e "  ${G}⏹ $svc (PID=$pid)${N}"
        fi
    done
    # Also kill by port in case PID file was stale
    for port in "$FRONTEND_PORT" "$RESOURCE_MONITOR_PORT" "$AGENT_BRIDGE_PORT"; do
        lsof -ti:$port 2>/dev/null | xargs -r kill -9 2>/dev/null
    done
    echo ""
}

do_status() {
    echo "📊 Service status:"
    for pair in "resource_monitor:${RESOURCE_MONITOR_PORT}" "agent_bridge:${AGENT_BRIDGE_PORT}" "frontend:${FRONTEND_PORT}"; do
        svc="${pair%%:*}"; port="${pair##*:}"
        if is_port_listening "$port"; then
            echo -e "  ${G}● $svc${N} (port $port)"
        else
            echo -e "  ${R}○ $svc${N} (port $port)"
        fi
    done
    echo ""
}

# Clear queues and projects that agent_bridge restores from disk (otherwise a restart resumes mid-pipeline)
do_reset_state() {
    RUNS="$BASE/backend/runs"
    SHARED="$BASE/backend/shared_results"
    echo "🧹 Clearing pipeline state..."
    rm -rf "$RUNS/projects"/* 2>/dev/null
    rm -f "$RUNS/queues"/*.json 2>/dev/null
    mkdir -p "$RUNS/projects" "$RUNS/queues"
    rm -rf "$SHARED/idea_runs"/* 2>/dev/null
    mkdir -p "$SHARED/idea_runs"
    rm -f "$SHARED/idea_pool"/* 2>/dev/null
    mkdir -p "$SHARED/idea_pool"
    rm -rf "$SHARED/knowledge_base"/* 2>/dev/null
    mkdir -p "$SHARED/knowledge_base"
    rm -rf "$SHARED/entries"/* 2>/dev/null
    mkdir -p "$SHARED/entries"
    rm -f "$SHARED/index.json" 2>/dev/null
    echo -e "  ${G}✅ Cleared: runs/projects, runs/queues, shared_results/idea_runs, idea_pool, knowledge_base, entries${N}"
    echo "   (datasets / checkpoints / codebases were kept to avoid re-downloading large files)"
    echo ""
}

case "${1:-start}" in
    start)        do_start ;;
    stop)         do_stop ;;
    restart)      do_stop; sleep 1; do_start ;;
    status)       do_status ;;
    reset-state)  do_reset_state ;;
    fresh)        do_stop; sleep 1; do_reset_state; do_start ;;
    *)            echo "Usage: $0 {start|stop|restart|status|reset-state|fresh} [eco|quality|custom]" ;;
esac
