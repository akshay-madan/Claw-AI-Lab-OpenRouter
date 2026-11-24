#!/bin/bash
# 🦞 Claw AI Lab — start / stop the app
# Usage: ./lab.sh <command> [eco|quality|custom|original]
#
#   start-app       start everything: web page server + agents (agent bridge, resource monitor)
#   stop-app        stop everything
#   restart-app     stop-app, then start-app
#   start-agents    start only the agents (the page's ▶ Start button does this)
#   stop-agents     stop only the agents; the page stays up (the page's ⏹ Stop button)
#   restart-agents  stop-agents, then start-agents
#   status          show what is running
#   reset-state     clear projects, queues and shared results (moved to backup/, not deleted).
#                   Run stop-app first; otherwise agent_bridge may write files back.
#   fresh           stop-app → reset-state → start-app (fresh run from scratch)
#
#   eco|quality|custom|original — model preset for this launch (default: `model_profile:` in config.yaml)

BASE="$(cd "$(dirname "$0")" && pwd)"
FE="$BASE/frontend"
LOG="$BASE/logs"
PIDF="$BASE/.pids"
RUNTIME_PORTS="$BASE/.runtime_ports"

# Load API keys from a private file outside the repo.
# Path: $CLAW_SECRETS_FILE > `secrets_file:` in config.yaml > ~/.config/claw-ai-lab/secrets.env
_cfg_secrets="$(sed -n 's/^secrets_file:[[:space:]]*"\{0,1\}\([^"#]*[^"#[:space:]]\)"\{0,1\}.*/\1/p' "$BASE/config.yaml" 2>/dev/null)"
SECRETS_FILE="${CLAW_SECRETS_FILE:-${_cfg_secrets:-$HOME/.config/claw-ai-lab/secrets.env}}"
case "$SECRETS_FILE" in "~/"*) SECRETS_FILE="$HOME/${SECRETS_FILE#\~/}" ;; esac
if [ -f "$SECRETS_FILE" ]; then
    if grep -qE '^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=' "$SECRETS_FILE"; then
        # KEY=value lines
        set -a
        # shellcheck disable=SC1090
        . "$SECRETS_FILE"
        set +a
        # Key stored under another name: OPENROUTER_API_KEY, or the only KEY=value in the file
        if [ -z "${RESEARCHCLAW_API_KEY:-}" ]; then
            _names="$(sed -nE 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=.*/\2/p' "$SECRETS_FILE" \
                | grep -vE '^(RESEARCHCLAW_IMAGE_API_KEY|RESEARCHCLAW_API_KEY|EXA_API_KEY|TAVILY_API_KEY)$' | sort -u)"
            case "$_names" in
                *[!A-Za-z0-9_]*) _names="OPENROUTER_API_KEY" ;;   # several names: use the usual one
            esac
            [ -n "$_names" ] && RESEARCHCLAW_API_KEY="${!_names:-}"
            export RESEARCHCLAW_API_KEY
        fi
    else
        # Bare key: first non-empty line is the OpenRouter key
        RESEARCHCLAW_API_KEY="$(grep -m1 -vE '^[[:space:]]*(#|$)' "$SECRETS_FILE" | tr -d '[:space:]')"
        export RESEARCHCLAW_API_KEY
    fi
elif [ -n "${CLAW_SECRETS_FILE:-}${_cfg_secrets}" ]; then
    echo "⚠️  secrets file not found: $SECRETS_FILE" >&2
fi
case "${1:-}" in
    start-app|restart-app|start-agents|restart-agents|fresh)
        [ -n "${RESEARCHCLAW_API_KEY:-}" ] || echo "⚠️  no API key found in $SECRETS_FILE; model calls will fail" >&2 ;;
esac

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
#   RESOURCE_MONITOR_PORT=8915 AGENT_BRIDGE_PORT=8916 FRONTEND_PORT=5913 ./lab.sh start-app
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

# True when the web page actually loads (an open port alone is not enough:
# a long-running page server can lose access to its files and answer HTTP 500)
page_loads() {
    [ "$(curl -s --noproxy '*' -o /dev/null -m 10 -w '%{http_code}' "http://localhost:${FRONTEND_PORT}/" 2>/dev/null)" = 200 ]
}

# True when the process on the page port is this project's Vite server
page_server_is_ours() {
    local pid
    pid="$(lsof -ti tcp:"$FRONTEND_PORT" -sTCP:LISTEN 2>/dev/null | head -1)"
    [ -n "$pid" ] && [ "$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" = "$(cd "$FE" && pwd -P)" ]
}

# do_start [agents-only]  (default: also start the web page server)
do_start() {
    local what="${1:-app}" rc=0 _i
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
    if [ "$what" = agents-only ]; then
        :
    elif is_port_listening "$FRONTEND_PORT" && page_loads; then
        echo -e "  ${Y}⏭ frontend already running (port ${FRONTEND_PORT})${N}"
    elif is_port_listening "$FRONTEND_PORT" && ! page_server_is_ours; then
        echo -e "  ${R}❌ port ${FRONTEND_PORT} is used by another program; page not started${N}"
        rc=1
    else
        if is_port_listening "$FRONTEND_PORT"; then
            echo -e "  ${Y}⚠️  page server is running but the page does not load; restarting it${N}"
            do_stop frontend >/dev/null
        fi
        cd "$FE"
        nohup env RESOURCE_MONITOR_PORT="$RESOURCE_MONITOR_PORT" AGENT_BRIDGE_PORT="$AGENT_BRIDGE_PORT" \
            npx vite --host 0.0.0.0 --port "$FRONTEND_PORT" \
            > "$LOG/frontend.log" 2>&1 &
        echo $! > "$PIDF/frontend.pid"
        cd "$BASE"
        for _i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
            sleep 1
            page_loads && break
        done
        if page_loads; then
            echo -e "  ${G}✅ frontend (PID=$(cat "$PIDF/frontend.pid"))${N}"
        else
            echo -e "  ${R}❌ page server started but the page does not load; see $LOG/frontend.log${N}"
            rc=1
        fi
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
    return $rc
}

# Kill a process and all its descendants (pipeline runs and experiments started by agent_bridge)
kill_tree() {
    local sig="$1" pid="$2" child
    for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$sig" "$child"; done
    kill "-$sig" "$pid" 2>/dev/null
}

# do_stop [services...]  (default: all). Stopping agent_bridge also stops its running agents.
do_stop() {
    local svcs="${*:-frontend agent_bridge resource_monitor}" svc f pid port
    echo "🛑 Stopping: $svcs"
    for svc in $svcs; do
        f="$PIDF/$svc.pid"
        if [ -f "$f" ]; then
            pid=$(cat "$f")
            kill_tree TERM "$pid" && sleep 0.5
            kill -0 "$pid" 2>/dev/null && kill_tree KILL "$pid"
            rm -f "$f"
            echo -e "  ${G}⏹ $svc (PID=$pid)${N}"
        fi
        # Also kill by port in case PID file was stale
        case "$svc" in
            frontend) port="$FRONTEND_PORT" ;;
            agent_bridge) port="$AGENT_BRIDGE_PORT" ;;
            resource_monitor) port="$RESOURCE_MONITOR_PORT" ;;
        esac
        for pid in $(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null); do kill_tree KILL "$pid"; done
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
    BK="$BASE/backup/state-$(date +%Y%m%d-%H%M%S)"
    echo "🧹 Clearing pipeline state (old state is moved to a backup, not deleted)..."
    mkdir -p "$BK/runs" "$BK/shared_results"
    for d in projects queues; do
        [ -e "$RUNS/$d" ] && mv "$RUNS/$d" "$BK/runs/$d"
    done
    for d in idea_runs idea_pool knowledge_base entries index.json; do
        [ -e "$SHARED/$d" ] && mv "$SHARED/$d" "$BK/shared_results/$d"
    done
    mkdir -p "$RUNS/projects" "$RUNS/queues" "$SHARED/idea_runs" "$SHARED/idea_pool" \
             "$SHARED/knowledge_base" "$SHARED/entries"
    echo -e "  ${G}✅ Cleared: runs/projects, runs/queues, shared_results/idea_runs, idea_pool, knowledge_base, entries${N}"
    echo "   Backup: $BK"
    echo "   To undo: ./lab.sh stop-app, move its folders back into backend/, then ./lab.sh start-app"
    echo "   (datasets / checkpoints / codebases were kept to avoid re-downloading large files)"
    echo ""
}

case "${1:-}" in
    start-app)      do_start ;;
    stop-app)       do_stop ;;
    restart-app)    do_stop; sleep 1; do_start ;;
    start-agents)   do_start agents-only ;;
    stop-agents)    do_stop agent_bridge resource_monitor ;;
    restart-agents) do_stop agent_bridge resource_monitor; sleep 1; do_start agents-only ;;
    status)         do_status ;;
    reset-state)    do_reset_state ;;
    fresh)          do_stop; sleep 1; do_reset_state; do_start ;;
    *)              sed -n '3,17p' "$0" | sed 's/^# \{0,1\}//'; [ -n "${1:-}" ] && exit 1 ;;
esac
