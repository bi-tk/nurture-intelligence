#!/bin/bash
# =============================================================================
# NURTURE INTELLIGENCE — AUTO-VERIFY PIPELINE
# Usage:
#   bash scripts/verify-and-fix.sh           # test production
#   bash scripts/verify-and-fix.sh --local   # test localhost:3000
# =============================================================================

VERIFY_SECRET="ni-verify-2026"
DEPLOYMENT="${DEPLOYMENT:-nurture-intelligence.vercel.app}"
PASS=0
FAIL=0

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║        NURTURE INTELLIGENCE AUTO-VERIFY              ║"
echo "╚══════════════════════════════════════════════════════╝"
echo "  Deployment: $DEPLOYMENT"
echo "  Time:       $(date)"
echo ""

# ── Fetch via vercel curl (bypasses Vercel SSO + our middleware bypass) ──────
fetch() {
  local path="$1"
  if [[ "$1" == "--local" ]]; then
    # local mode: plain curl against localhost
    curl -s --max-time 120 \
      --header "X-Verify-Secret: $VERIFY_SECRET" \
      --header "Accept: application/json" \
      "http://localhost:3000$path"
  else
    vercel curl --deployment "$DEPLOYMENT" "$path" -- \
      -H "X-Verify-Secret: $VERIFY_SECRET" \
      -H "Accept: application/json" \
      -s 2>/dev/null | tail -1
  fi
}

# ── Extract dot-path value from JSON ─────────────────────────────────────────
jval() {
  local json="$1"
  local path="$2"
  node -e "
    try {
      const j = JSON.parse(process.argv[1]);
      const parts = process.argv[2].split('.');
      let v = j;
      for (const p of parts) {
        if (v == null) break;
        if (p === 'length' && Array.isArray(v)) { v = v.length; break; }
        v = v[p];
      }
      if (Array.isArray(v)) process.stdout.write(String(v.length));
      else if (v == null) process.stdout.write('null');
      else process.stdout.write(String(v));
    } catch(e) { process.stdout.write('ERR'); }
  " "$json" "$path" 2>/dev/null
}

# ── Single check ─────────────────────────────────────────────────────────────
check() {
  local name="$1"
  local json="$2"
  local path="$3"
  local expected="$4"
  local value status

  value=$(jval "$json" "$path")

  case "$expected" in
    ">0")      node -e "process.exit(parseFloat('$value')>0?0:1)" 2>/dev/null && status="PASS" || status="FAIL" ;;
    ">100")    node -e "process.exit(parseFloat('$value')>100?0:1)" 2>/dev/null && status="PASS" || status="FAIL" ;;
    ">500")    node -e "process.exit(parseFloat('$value')>500?0:1)" 2>/dev/null && status="PASS" || status="FAIL" ;;
    "notempty") [[ -n "$value" && "$value" != "null" && "$value" != "" ]] && status="PASS" || status="FAIL" ;;
    *)          [[ "$value" == "$expected" ]] && status="PASS" || status="FAIL" ;;
  esac

  if [[ "$status" == "PASS" ]]; then
    printf "  \033[32m✓\033[0m %-12s %-34s = %s\n" "[$name]" "$path" "$value"
    PASS=$((PASS+1))
  else
    printf "  \033[31m✗\033[0m %-12s %-34s = %-20s  (want: %s)\n" "[$name]" "$path" "$value" "$expected"
    FAIL=$((FAIL+1))
  fi
}

# ── Fetch all endpoints ───────────────────────────────────────────────────────
echo "  Fetching endpoints (allow 60-120s for cold start)..."
echo ""

MODE="${1:-}"
if [[ "$MODE" == "--local" ]]; then
  KPI=$(fetch --local /api/kpis)
  FUNNEL=$(fetch --local /api/funnel)
  CONTACTS=$(fetch --local /api/contacts)
  SEQUENCES=$(fetch --local /api/sequences)
  SEGMENTS=$(fetch --local /api/segments)
else
  KPI=$(fetch /api/kpis)
  FUNNEL=$(fetch /api/funnel)
  CONTACTS=$(fetch /api/contacts)
  SEQUENCES=$(fetch /api/sequences)
  SEGMENTS=$(fetch /api/segments)
fi

# ── Diagnostic snapshot ───────────────────────────────────────────────────────
echo "--- DIAGNOSTIC SNAPSHOT ---"
printf "  %-10s sf=%-6s pardot=%-6s mqls=%-8s sqls=%-8s dcs=%-8s won=%s\n" \
  "kpis:" "$(jval "$KPI" sfConnected)" "$(jval "$KPI" pardotConnected)" \
  "$(jval "$KPI" mqls)" "$(jval "$KPI" sqls)" "$(jval "$KPI" discoveryCalls)" \
  "$(jval "$KPI" wonRevenue)"
printf "  %-10s audience=%-8s emailsSent=%-8s openRate=%s%%\n" \
  "" "$(jval "$KPI" totalAudience)" "$(jval "$KPI" emailsSent)" "$(jval "$KPI" uniqueOpenRate)"

printf "  %-10s nurtureTotal=%-8s mqls=%-8s sqls=%-8s dcs=%s\n" \
  "funnel:" "$(jval "$FUNNEL" nurtureTotal)" "$(jval "$FUNNEL" mqls)" \
  "$(jval "$FUNNEL" sqls)" "$(jval "$FUNNEL" discoveryCalls)"

printf "  %-10s connected=%-6s prospects=%-6s hot=%-6s warm=%s\n" \
  "contacts:" "$(jval "$CONTACTS" connected)" "$(jval "$CONTACTS" prospects.length)" \
  "$(jval "$CONTACTS" buckets.hot)" "$(jval "$CONTACTS" buckets.warm)"

printf "  %-10s connected=%-6s sequences=%-6s titles=%s\n" \
  "sequences:" "$(jval "$SEQUENCES" connected)" "$(jval "$SEQUENCES" sequences.length)" \
  "$(jval "$SEQUENCES" prospectTitles.length)"

printf "  %-10s pardot=%-6s segments=%-4s newsletter.members=%-6s industries=%s\n" \
  "segments:" "$(jval "$SEGMENTS" pardotConnected)" "$(jval "$SEGMENTS" segments.length)" \
  "$(jval "$SEGMENTS" newsletter.members)" "$(jval "$SEGMENTS" industries.length)"

echo ""
echo "--- CHECKS ---"

check "KPIs"      "$KPI"       "sfConnected"            "true"
check "KPIs"      "$KPI"       "pardotConnected"        "true"
check "KPIs"      "$KPI"       "wonRevenue"             ">0"
check "KPIs"      "$KPI"       "totalAudience"          ">500"
check "KPIs"      "$KPI"       "mqls"                   ">100"
check "KPIs"      "$KPI"       "emailsSent"             ">0"

check "Funnel"    "$FUNNEL"    "sfConnected"            "true"
check "Funnel"    "$FUNNEL"    "nurtureTotal"           ">0"
check "Funnel"    "$FUNNEL"    "mqls"                   ">100"
check "Funnel"    "$FUNNEL"    "sqls"                   ">0"
check "Funnel"    "$FUNNEL"    "discoveryCalls"         ">0"
check "Funnel"    "$FUNNEL"    "stages.length"          "7"

check "Contacts"  "$CONTACTS"  "connected"              "true"
check "Contacts"  "$CONTACTS"  "total"                  "6421"
check "Contacts"  "$CONTACTS"  "buckets.warm"           ">0"
check "Contacts"  "$CONTACTS"  "prospects.length"       ">0"

check "Sequences" "$SEQUENCES" "connected"              "true"
check "Sequences" "$SEQUENCES" "sequences.length"       ">0"
check "Sequences" "$SEQUENCES" "subjectLines.length"    ">0"
check "Sequences" "$SEQUENCES" "prospectTitles.length"  ">0"

check "Segments"  "$SEGMENTS"  "pardotConnected"        "true"
check "Segments"  "$SEGMENTS"  "segments.length"        "7"
check "Segments"  "$SEGMENTS"  "segments.0.members"     ">0"
check "Segments"  "$SEGMENTS"  "newsletter.members"     ">0"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
printf "  Results: \033[32m%d passed\033[0m, \033[31m%d failed\033[0m\n" "$PASS" "$FAIL"
echo "══════════════════════════════════════════════"
echo ""

[[ $FAIL -eq 0 ]] && exit 0 || exit 1
