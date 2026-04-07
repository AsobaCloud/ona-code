#!/usr/bin/env bash
# SDLC acceptance — black-box checks per CLEAN_ROOM_SPEC.md
# Invokes: node "$ONA", sqlite3 "$AGENT_SDLC_DB", python3 (mock HTTP only). No Node imports.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
export ONA=${ONA:-"$REPO_ROOT/bin/agent.mjs"}

PASS=0
SKIP=0
TOTAL=0

cleanup() {
  local ec=$?
  if [[ -n "${MOCK_PID:-}" ]]; then kill "$MOCK_PID" 2>/dev/null || true; wait "$MOCK_PID" 2>/dev/null || true; fi
  [[ -n "${ACCEPT_TMP:-}" && -d "$ACCEPT_TMP" ]] && rm -rf "$ACCEPT_TMP" || true
  return "$ec"
}
trap cleanup EXIT

ACCEPT_TMP=$(mktemp -d "${TMPDIR:-/tmp}/sdlc-accept.XXXXXX")
export ACCEPT_TMP

command -v node >/dev/null 2>&1 || { echo "sdlc-acceptance: node required" >&2; exit 2; }
command -v sqlite3 >/dev/null 2>&1 || { echo "sdlc-acceptance: sqlite3 required" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "sdlc-acceptance: python3 required" >&2; exit 2; }
[[ -f "$ONA" ]] || { echo "sdlc-acceptance: ONA not found: $ONA" >&2; exit 2; }

run_check() {
  local row_id="$1"; shift
  TOTAL=$((TOTAL + 1))
  if "$@"; then
    PASS=$((PASS + 1)); echo "  PASS: $row_id"
  else
    echo "  FAIL: $row_id" >&2; exit 1
  fi
}

skip_row() {
  local row_id="$1" reason="$2"
  TOTAL=$((TOTAL + 1)); SKIP=$((SKIP + 1))
  echo "  SKIP: $row_id — $reason" >&2
}

ona_pipe() {
  local input="$1"
  { printf '%s\n' "$input"; } | node "$ONA" 2>&1
}

db() {
  sqlite3 -cmd ".output /dev/null" -cmd "PRAGMA foreign_keys=ON;" -cmd "PRAGMA busy_timeout=30000;" -cmd ".output stdout" "$AGENT_SDLC_DB" "$@"
}

put_effective_json() {
  local json="$1"
  local esc="${json//\'/\'\'}"
  db "INSERT OR REPLACE INTO settings_snapshot(scope,json,updated_at) VALUES ('effective','$esc',datetime('now'))"
}

fresh_db() {
  export AGENT_SDLC_DB="$ACCEPT_TMP/db_${1}.db"
  rm -f "$AGENT_SDLC_DB" "$AGENT_SDLC_DB-wal" "$AGENT_SDLC_DB-shm" 2>/dev/null || true
  SDLC_DISABLE_ALL_HOOKS=1 node "$ONA" --init-db >/dev/null 2>&1
}

stop_mock() {
  if [[ -n "${MOCK_PID:-}" ]]; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
    MOCK_PID=
  fi
}

MOCK_PORT=18765

write_mock_server() {
  local port="$1"
  export MOCK_PORT="$port"
  local py="$ACCEPT_TMP/mock_openai.py"
  cat >"$py" <<PY
import json, re
from http.server import HTTPServer, BaseHTTPRequestHandler

def tool_resp(name, args_obj):
    return {"id": "call_sdlc", "type": "function", "function": {"name": name, "arguments": json.dumps(args_obj)}}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path in ("/v1/models", "/"):
            b = json.dumps({"data": [{"id":"mock-model","object":"model","owned_by":"test"}]}).encode()
            self.send_response(200); self.send_header("Content-Type","application/json"); self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b); return
        self.send_error(404)
    def do_POST(self):
        if self.path != "/v1/chat/completions": self.send_error(404); return
        ln = int(self.headers.get("Content-Length","0"))
        body = self.rfile.read(ln)
        try: req = json.loads(body.decode("utf-8","replace"))
        except: req = {}
        msgs = req.get("messages") or []
        last = ""
        if msgs:
            c = msgs[-1].get("content")
            last = c if isinstance(c, str) else json.dumps(c)
        tool_calls = None; content = None
        m = re.search(r"__TOOL__:([A-Za-z0-9_]+):(.*)", last, re.DOTALL)
        if m:
            tname, rest = m.group(1), m.group(2).strip()
            try: args = json.loads(rest)
            except: args = {"raw": rest}
            tool_calls = [tool_resp(tname, args)]
        elif "__ASSIST_TEXT__:" in last:
            content = last.split("__ASSIST_TEXT__:",1)[1].strip()
        if tool_calls is None and content is None: content = "(mock) no directive"
        msg = {"role":"assistant"}
        if content is not None: msg["content"] = content
        if tool_calls is not None: msg["tool_calls"] = tool_calls
        # Return SSE streaming format (ona always sends stream:true)
        self.send_response(200)
        self.send_header("Content-Type","text/event-stream")
        self.send_header("Cache-Control","no-cache")
        self.end_headers()
        # First chunk: role
        d0 = {"id":"chatcmpl-mock","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":None}]}
        self.wfile.write(("data: "+json.dumps(d0)+"\n\n").encode())
        # Content or tool_calls chunk
        if content is not None:
            d1 = {"id":"chatcmpl-mock","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":content},"finish_reason":None}]}
            self.wfile.write(("data: "+json.dumps(d1)+"\n\n").encode())
        if tool_calls is not None:
            for i, tc in enumerate(tool_calls):
                d1 = {"id":"chatcmpl-mock","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":i,"id":tc["id"],"type":"function","function":{"name":tc["function"]["name"],"arguments":tc["function"]["arguments"]}}]},"finish_reason":None}]}
                self.wfile.write(("data: "+json.dumps(d1)+"\n\n").encode())
        # Final chunk: finish_reason
        d2 = {"id":"chatcmpl-mock","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop" if content else "tool_calls"}]}
        self.wfile.write(("data: "+json.dumps(d2)+"\n\n").encode())
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()

if __name__ == "__main__":
    HTTPServer(("127.0.0.1", $port), H).serve_forever()
PY
  python3 "$py" &
  MOCK_PID=$!
  sleep 0.5
}

# Helper: run one tool via --eval, return JSON result
# --eval creates its own conversation in idle, but Read/Glob/Grep/ToolSearch/etc work in idle.
# For mutating tools (Write/Edit/Bash), we seed the DB in implement phase first.
tool_one() {
  local row="$1" tool="$2" args="$3"
  fresh_db "tool_$row"
  # Seed in implement phase with approved plan so planning gate allows mutating tools
  db "UPDATE conversations SET phase='implement' WHERE 1=1"
  local conv_id
  conv_id=$(db "SELECT id FROM conversations LIMIT 1")
  db "INSERT INTO plans(conversation_id,content,hash,status) VALUES ('$conv_id','test plan','abc','approved')"
  # Use --eval which respects the existing DB state
  SDLC_DISABLE_ALL_HOOKS=1 node "$ONA" --eval '{"tool":"'"$tool"'","input":'"$args"'}' 2>&1 || true
}

export -f ona_pipe db put_effective_json fresh_db
export ONA ACCEPT_TMP REPO_ROOT

echo "=== ona SDLC acceptance tests ==="
echo "TMP: $ACCEPT_TMP"

# ═══ §4 Storage ═══════════════════════════════════════════════

echo "[§4 Storage]"

row_01() {
  fresh_db row01
  tables=$(db ".tables")
  for t in schema_meta conversations sessions state plans summaries events task_ratings memories transcript_entries hook_invocations tool_permission_log settings_snapshot; do
    echo "$tables" | grep -q "$t" || { echo "missing table: $t"; return 1; }
  done
}
run_check ROW-01 row_01

row_02() { fresh_db row02; v=$(db "SELECT value FROM schema_meta WHERE key='schema_version'"); test "$v" = "1"; }
run_check ROW-02 row_02

row_03() { fresh_db row03; v=$(db "PRAGMA foreign_keys"); test "$v" = "1"; }
run_check ROW-03 row_03

row_04() { fresh_db row04; v=$(db "PRAGMA journal_mode"); test "$v" = "wal"; }
run_check ROW-04 row_04

row_05() { fresh_db row05; v=$(db "PRAGMA busy_timeout"); test "$v" = "30000"; }
run_check ROW-05 row_05

# ═══ §2.9 REPL commands ══════════════════════════════════════

echo "[§2.9 REPL commands]"

row_30() {
  fresh_db row30
  out=$(echo "/help" | SDLC_DISABLE_ALL_HOOKS=1 node "$ONA" 2>&1)
  echo "$out" | grep -qi "model" && echo "$out" | grep -qi "login" && echo "$out" | grep -qi "status"
}
run_check ROW-30 row_30

row_31() {
  fresh_db row31
  out=$(echo "/model" | SDLC_DISABLE_ALL_HOOKS=1 node "$ONA" 2>&1)
  echo "$out" | grep -qi "available\|provider\|lm_studio"
}
run_check ROW-31 row_31

row_34() {
  fresh_db row34
  write_mock_server 18710
  printf "%s\n" "hello" "/clear" "/exit" | \
    LM_STUDIO_BASE_URL="http://127.0.0.1:18710/v1" LM_STUDIO_MODEL=mock SDLC_DISABLE_ALL_HOOKS=1 node "$ONA" >/dev/null 2>&1 || true
  stop_mock
  cnt=$(db "SELECT COUNT(DISTINCT conversation_id) FROM sessions")
  test "$cnt" -ge 2
}
run_check ROW-34 row_34

row_36() { fresh_db row36; out=$(echo "/config" | SDLC_DISABLE_ALL_HOOKS=1 node "$ONA" 2>&1); echo "$out" | grep -q "model_config\|provider"; }
run_check ROW-36 row_36

row_37() { fresh_db row37; out=$(echo "/status" | SDLC_DISABLE_ALL_HOOKS=1 node "$ONA" 2>&1); echo "$out" | grep -qi "ok\|kind\|source\|auth"; }
run_check ROW-37 row_37

row_38() { fresh_db row38; echo "/exit" | SDLC_DISABLE_ALL_HOOKS=1 node "$ONA" >/dev/null 2>&1; }
run_check ROW-38 row_38

# ═══ §5 Hook plane ═══════════════════════════════════════════

echo "[§5 Hooks]"

row_40() { node "$REPO_ROOT/scripts/verify-sdlc-hook-order.mjs"; }
run_check ROW-40 row_40

row_49() {
  fresh_db row49
  put_effective_json '{"hooks":[{"hook_event_name":"SessionStart","matcher":"*","command":"echo hooked"}]}'
  echo "/exit" | SDLC_DISABLE_ALL_HOOKS=1 node "$ONA" >/dev/null 2>&1 || true
  cnt=$(db "SELECT COUNT(*) FROM hook_invocations")
  test "$cnt" = "0"
}
run_check ROW-49 row_49

# ═══ §5.12 Permissions ═══════════════════════════════════════

echo "[§5.12 Permissions]"

row_50() {
  node --input-type=module -e "
import { evaluatePermission } from './lib/permissions.mjs'
const p = { defaultMode: 'default', deny: ['Bash'], allow: ['Read'] }
if (evaluatePermission(p, 'Bash', {}) !== 'deny') process.exit(1)
if (evaluatePermission(p, 'Read', {}) !== 'allow') process.exit(1)
if (evaluatePermission(p, 'Write', {}) !== 'ask') process.exit(1)
"
}
run_check ROW-50 row_50

row_51() {
  node --input-type=module -e "
import { evaluatePermission } from './lib/permissions.mjs'
if (evaluatePermission({ defaultMode: 'bypassPermissions' }, 'Bash', {}) !== 'allow') process.exit(1)
"
}
run_check ROW-51 row_51

row_52() {
  node --input-type=module -e "
import { evaluatePermission } from './lib/permissions.mjs'
if (evaluatePermission({ defaultMode: 'plan' }, 'Write', {}) !== 'deny') process.exit(1)
"
}
run_check ROW-52 row_52

# ═══ §7 Tools ═════════════════════════════════════════════════

echo "[§7 Tools]"

write_mock_server 18766

row_60() {
  echo "test_read_content" > "$ACCEPT_TMP/tread.txt"
  pj=$(tool_one 60 Read '{"file_path":"'"$ACCEPT_TMP/tread.txt"'"}')
  echo "$pj" | grep -q '"is_error":false' && echo "$pj" | grep -q "test_read_content"
}
run_check ROW-60 row_60

row_61() {
  pj=$(tool_one 61 Read '{"file_path": "'"$ACCEPT_TMP/nonexistent_xyz"'"}')
  echo "$pj" | grep -q '"is_error":true'
}
run_check ROW-61 row_61

row_62() {
  pj=$(tool_one 62 Write '{"file_path": "'"$ACCEPT_TMP/twrite.txt"'", "content": "written_by_test"}')
  echo "$pj" | grep -q '"is_error":false'
  grep -q "written_by_test" "$ACCEPT_TMP/twrite.txt"
}
run_check ROW-62 row_62

row_63() {
  echo "old_text_here" > "$ACCEPT_TMP/tedit.txt"
  pj=$(tool_one 63 Edit '{"file_path": "'"$ACCEPT_TMP/tedit.txt"'", "old_string": "old_text_here", "new_string": "new_text_here"}')
  echo "$pj" | grep -q '"is_error":false'
  grep -q "new_text_here" "$ACCEPT_TMP/tedit.txt"
}
run_check ROW-63 row_63

row_64() {
  mkdir -p "$ACCEPT_TMP/globdir"
  touch "$ACCEPT_TMP/globdir/a.txt" "$ACCEPT_TMP/globdir/b.js"
  pj=$(tool_one 64 Glob '{"pattern": "*.txt", "path": "'"$ACCEPT_TMP/globdir"'"}')
  echo "$pj" | grep -q "a.txt"
}
run_check ROW-64 row_64

row_65() {
  echo "findme_unique_string" > "$ACCEPT_TMP/grepfile.txt"
  pj=$(tool_one 65 Grep '{"pattern": "findme_unique_string", "path": "'"$ACCEPT_TMP/grepfile.txt"'"}')
  echo "$pj" | grep -q "grepfile"
}
run_check ROW-65 row_65

row_67() {
  pj=$(tool_one 67 Bash '{"command": "echo hello_ona_acceptance"}')
  echo "$pj" | grep -q "hello_ona_acceptance" && echo "$pj" | grep -q '"is_error":false'
}
run_check ROW-67 row_67

row_68() {
  pj=$(tool_one 68 Bash '{"command": "exit 42"}')
  echo "$pj" | grep -q '"is_error":true'
}
run_check ROW-68 row_68

row_74() {
  # EnterPlanMode via --eval
  fresh_db row74
  pj=$(SDLC_DISABLE_ALL_HOOKS=1 node "$ONA" --eval '{"tool":"EnterPlanMode","input":{}}' 2>&1 || true)
  echo "$pj" | grep -q '"is_error":false'
  # Check that at least one conversation is in planning (--eval creates its own)
  cnt=$(db "SELECT COUNT(*) FROM conversations WHERE phase='planning'")
  test "$cnt" -ge 1
}
run_check ROW-74 row_74

row_83() {
  pj=$(tool_one 83 Skill '{"skill": "help"}')
  echo "$pj" | grep -q '"is_error":false'
}
run_check ROW-83 row_83

row_84() {
  pj=$(tool_one 84 ToolSearch '{"query": "Read"}')
  echo "$pj" | grep -qi "read"
}
run_check ROW-84 row_84

row_85() {
  pj=$(tool_one 85 ListMcpResources '{}')
  echo "$pj" | grep -q '"is_error":false'
}
run_check ROW-85 row_85

stop_mock

# ═══ §8 Workflow ══════════════════════════════════════════════

echo "[§8 Workflow]"

row_91() {
  fresh_db row91
  db "UPDATE conversations SET phase='implement' WHERE 1=1"
  local conv_id
  conv_id=$(db "SELECT id FROM conversations LIMIT 1")
  node "$ONA" --transition verify --conversation "$conv_id" 2>&1 && return 1 || true
  phase=$(db "SELECT phase FROM conversations WHERE id='$conv_id'")
  test "$phase" = "implement"
}
run_check ROW-91 row_91

row_92() {
  fresh_db row92
  db "UPDATE conversations SET phase='implement' WHERE 1=1"
  local conv_id
  conv_id=$(db "SELECT id FROM conversations LIMIT 1")
  node "$ONA" --transition test --conversation "$conv_id" >/dev/null 2>&1
  phase=$(db "SELECT phase FROM conversations WHERE id='$conv_id'")
  test "$phase" = "test"
}
run_check ROW-92 row_92

row_95() {
  # Planning gate blocks Write in idle (all mutating tools blocked outside implement)
  fresh_db row95
  pj=$(SDLC_DISABLE_ALL_HOOKS=1 node "$ONA" --eval '{"tool":"Write","input":{"file_path":"/tmp/sdlc_block","content":"x"}}' 2>&1 || true)
  echo "$pj" | grep -q "denied\|SDLC"
}
run_check ROW-95 row_95

# ═══ §0 Forbidden ═════════════════════════════════════════════

echo "[§0 Forbidden patterns]"

row_100() {
  for tool in Read Glob Grep Brief TodoWrite TaskOutput TaskStop EnterPlanMode Skill ToolSearch ListMcpResources ReadMcpResource; do
    pj=$(tool_one "100_$tool" "$tool" '{}')
    if echo "$pj" | grep -qi "not implemented"; then echo "STUB: $tool"; return 1; fi
  done
}
run_check ROW-100 row_100

# ═══ §13 Payloads ═════════════════════════════════════════════

echo "[§13 Payloads]"

row_110() {
  write_mock_server 18810
  fresh_db row110
  printf "%s\n" "__ASSIST_TEXT__:hello" "/exit" | \
    LM_STUDIO_BASE_URL="http://127.0.0.1:18810/v1" LM_STUDIO_MODEL=mock SDLC_DISABLE_ALL_HOOKS=1 node "$ONA" >/dev/null 2>&1 || true
  stop_mock
  pj=$(db "SELECT payload_json FROM transcript_entries WHERE entry_type='user' LIMIT 1")
  echo "$pj" | grep -q "_t.*user"
}
run_check ROW-110 row_110

row_111() {
  write_mock_server 18811
  fresh_db row111
  printf "%s\n" "__ASSIST_TEXT__:test" "/exit" | \
    LM_STUDIO_BASE_URL="http://127.0.0.1:18811/v1" LM_STUDIO_MODEL=mock SDLC_DISABLE_ALL_HOOKS=1 node "$ONA" >/dev/null 2>&1 || true
  stop_mock
  pj=$(db "SELECT payload_json FROM transcript_entries WHERE entry_type='assistant' LIMIT 1")
  echo "$pj" | grep -q "_t.*assistant"
}
run_check ROW-111 row_111

# ═══ Summary ══════════════════════════════════════════════════

echo ""
echo "=== Results: $PASS passed, $SKIP skipped, $((TOTAL - PASS - SKIP)) failed out of $TOTAL ==="
if [[ $((TOTAL - PASS - SKIP)) -gt 0 ]]; then exit 1; fi
echo "ALL PASS"
