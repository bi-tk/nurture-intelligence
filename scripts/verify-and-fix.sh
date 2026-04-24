#!/bin/bash
# =============================================================================
# NURTURE INTELLIGENCE — AUTO-VERIFY & FIX PIPELINE
# Usage:
#   bash scripts/verify-and-fix.sh           # test production
#   bash scripts/verify-and-fix.sh --local   # test localhost:3000
#   BASE=https://custom.url bash scripts/verify-and-fix.sh
# =============================================================================

VERIFY_SECRET="${VERIFY_SECRET:-ni-verify-2026}"
PASS=0
FAIL=0

# Determine base URL
if [[ "$1" == "--local" ]]; then
  BASE="http://localhost:3000"
else
  BASE="${BASE:-https://nurture-intelligence-8myy3rwe6.vercel.app}"
fi

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║        NURTURE INTELLIGENCE AUTO-VERIFY              ║"
echo "╚══════════════════════════════════════════════════════╝"
echo "  Target: $BASE"
echo "  Time:   $(date)"
echo ""

# ── Fetch JSON with auth bypass ──────────────────────────────────────────────
fetch() {
  curl -s --max-time 120 \
    --header "X-Verify-Secret: $VERIFY_SECRET" \
    --header "Accept: application/json" \
    "$1"
}

# ── Extract dot-path value from JSON string using node ───────────────────────
# Usage: val=$(jval "$json_string" "some.nested.key")
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
    } catch(e) { process.stdout.write('PARSE_ERR'); }
  " "$json" "$path" 2>/dev/null
}

# ── Single check ─────────────────────────────────────────────────────────────
check() {
  local name="$1"
  local json="$2"
  local path="$3"
  local expected="$4"

  local value
  value=$(jval "$json" "$path")

  local status
  case "$expected" in
    ">0")   node -e "process.exit(parseFloat('$value')>0?0:1)" 2>/dev/null && status="PASS" || status="FAIL" ;;
    ">100") node -e "process.exit(parseFloat('$value')>100?0:1)" 2>/dev/null && status="PASS" || status="FAIL" ;;
    ">500") node -e "process.exit(parseFloat('$value')>500?0:1)" 2>/dev/null && status="PASS" || status="FAIL" ;;
    *)      [[ "$value" == "$expected" ]] && status="PASS" || status="FAIL" ;;
  esac

  if [[ "$status" == "PASS" ]]; then
    printf "  \033[32m✓\033[0m %-12s %-34s = %s\n" "[$name]" "$path" "$value"
    PASS=$((PASS+1))
  else
    printf "  \033[31m✗\033[0m %-12s %-34s = %-20s  (want: %s)\n" "[$name]" "$path" "$value" "$expected"
    FAIL=$((FAIL+1))
  fi
}

# ── Fetch all endpoints up front ─────────────────────────────────────────────
echo "  Fetching endpoints (this may take 60-90s on cold start)..."
echo ""

KPI=$(fetch "$BASE/api/kpis")
FUNNEL=$(fetch "$BASE/api/funnel")
CONTACTS=$(fetch "$BASE/api/contacts")
SEQUENCES=$(fetch "$BASE/api/sequences")
SEGMENTS=$(fetch "$BASE/api/segments")

# ── Detect auth redirect ──────────────────────────────────────────────────────
for pair in "kpis:$KPI" "funnel:$FUNNEL" "contacts:$CONTACTS" "sequences:$SEQUENCES" "segments:$SEGMENTS"; do
  ep="${pair%%:*}"
  resp="${pair#*:}"
  if echo "$resp" | grep -q "<!DOCTYPE\|<html\|Redirecting\|Found"; then
    echo "  FATAL: /api/$ep returned HTML — auth bypass not working"
    echo "  Check VERIFY_SECRET env var is set on the server."
    echo ""
    exit 1
  fi
done

# ── Diagnostic prints ─────────────────────────────────────────────────────────
echo "--- DIAGNOSTIC SNAPSHOT ---"
printf "  %-10s sfConnected=%-6s pardotConnected=%-6s wonRevenue=%-12s totalAudience=%s\n" \
  "kpis:" "$(jval "$KPI" sfConnected)" "$(jval "$KPI" pardotConnected)" \
  "$(jval "$KPI" wonRevenue)" "$(jval "$KPI" totalAudience)"

printf "  %-10s mqls=%-8s sqls=%-8s discoveryCalls=%s\n" \
  "funnel:" "$(jval "$FUNNEL" mqls)" "$(jval "$FUNNEL" sqls)" "$(jval "$FUNNEL" discoveryCalls)"

printf "  %-10s connected=%-6s prospects=%s  hot=%s  warm=%s\n" \
  "contacts:" "$(jval "$CONTACTS" connected)" "$(jval "$CONTACTS" prospects.length)" \
  "$(jval "$CONTACTS" buckets.hot)" "$(jval "$CONTACTS" buckets.warm)"

printf "  %-10s connected=%-6s sequences=%s  prospectTitles=%s\n" \
  "sequences:" "$(jval "$SEQUENCES" connected)" "$(jval "$SEQUENCES" sequences.length)" \
  "$(jval "$SEQUENCES" prospectTitles.length)"

printf "  %-10s pardotConnected=%-6s segments=%s  newsletter.members=%s  industries=%s\n" \
  "segments:" "$(jval "$SEGMENTS" pardotConnected)" "$(jval "$SEGMENTS" segments.length)" \
  "$(jval "$SEGMENTS" newsletter.members)" "$(jval "$SEGMENTS" industries.length)"

echo ""
echo "--- CHECKS ---"

# /api/kpis
check "KPIs"      "$KPI"       "sfConnected"              "true"
check "KPIs"      "$KPI"       "pardotConnected"          "true"
check "KPIs"      "$KPI"       "wonRevenue"               ">0"
check "KPIs"      "$KPI"       "totalAudience"            ">500"
check "KPIs"      "$KPI"       "mqls"                     ">0"
check "KPIs"      "$KPI"       "emailsSent"               ">0"

# /api/funnel
check "Funnel"    "$FUNNEL"    "sfConnected"              "true"
check "Funnel"    "$FUNNEL"    "nurtureTotal"             ">0"
check "Funnel"    "$FUNNEL"    "mqls"                     ">100"
check "Funnel"    "$FUNNEL"    "sqls"                     ">0"
check "Funnel"    "$FUNNEL"    "discoveryCalls"           ">0"
check "Funnel"    "$FUNNEL"    "stages.length"            "7"

# /api/contacts
check "Contacts"  "$CONTACTS"  "connected"                "true"
check "Contacts"  "$CONTACTS"  "total"                    "6421"
check "Contacts"  "$CONTACTS"  "buckets.hot"              ">0"
check "Contacts"  "$CONTACTS"  "prospects.length"         ">0"

# /api/sequences
check "Sequences" "$SEQUENCES" "connected"                "true"
check "Sequences" "$SEQUENCES" "sequences.length"         ">0"
check "Sequences" "$SEQUENCES" "subjectLines.length"      ">0"
check "Sequences" "$SEQUENCES" "prospectTitles.length"    ">0"

# /api/segments
check "Segments"  "$SEGMENTS"  "pardotConnected"          "true"
check "Segments"  "$SEGMENTS"  "segments.length"          "7"
check "Segments"  "$SEGMENTS"  "newsletter.members"       ">0"
check "Segments"  "$SEGMENTS"  "industries.length"        ">0"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
printf "  Results: \033[32m%d passed\033[0m, \033[31m%d failed\033[0m\n" "$PASS" "$FAIL"
echo "══════════════════════════════════════════════"
echo ""

[[ $FAIL -eq 0 ]] && exit 0 || exit 1
