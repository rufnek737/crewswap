#!/bin/bash
# 주간 서비스 점검 — 서버 오류·무료 한도·도메인 만료를 본다. 문제 있으면 "⚠️" 줄을 찍는다.
#   bash scripts/health-check.sh
# Cloudflare 토큰은 저장소에 두지 않고 wrangler 로그인 정보를 쓴다.
TOK=$(grep -m1 '^oauth_token' ~/Library/Preferences/.wrangler/config/default.toml | cut -d'"' -f2)
ACC=ee016d87636c85a8571356660ffbc0b3
S=$(date -u -v-7d +%Y-%m-%d); E=$(date -u +%Y-%m-%d); ST=$(date -u -v-7d +%Y-%m-%dT00:00:00Z)
Q="{viewer{accounts(filter:{accountTag:\\\"$ACC\\\"}){w:workersInvocationsAdaptive(limit:20,filter:{date_geq:\\\"$S\\\",date_leq:\\\"$E\\\",scriptName:\\\"crewswap-api\\\"},orderBy:[date_ASC]){sum{requests errors} dimensions{date}} s:workersInvocationsAdaptive(limit:20,filter:{datetime_geq:\\\"$ST\\\",scriptName:\\\"crewswap-api\\\"}){sum{requests} dimensions{status}} d:d1AnalyticsAdaptiveGroups(limit:20,filter:{date_geq:\\\"$S\\\",date_leq:\\\"$E\\\"},orderBy:[date_ASC]){sum{rowsRead rowsWritten} dimensions{date}}}}}"
curl -s https://api.cloudflare.com/client/v4/graphql -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' --data "{\"query\":\"$Q\"}" > /tmp/crewswap-health.json
python3 - <<'PY'
import json
d=json.load(open('/tmp/crewswap-health.json'))
if d.get('errors') or not d.get('data'): print('⚠️ Cloudflare 조회 실패 (wrangler 로그인 만료일 수 있음):', d.get('errors')); raise SystemExit
a=d['data']['viewer']['accounts'][0]
print('== Worker (하루 요청 / 오류) — 무료 한도 100,000/일')
for r in a['w']:
    n,e=r['sum']['requests'],r['sum']['errors']; print(' ',r['dimensions']['date'],n,e)
    if n>50000: print('⚠️ 요청이 무료 한도의 50% 초과')
    if n and e/n>0.02: print('⚠️ 오류율 2% 초과')
bad={r['dimensions']['status']:r['sum']['requests'] for r in a['s'] if r['dimensions']['status']!='success'}
print('== 실패 상태:', bad or '없음')
if bad: print('⚠️ 실패한 요청 있음', bad)
print('== D1 (행 읽기 / 쓰기) — 무료 한도 5,000,000 / 100,000 /일')
for r in a['d']:
    rd,wr=r['sum']['rowsRead'],r['sum']['rowsWritten']; print(' ',r['dimensions']['date'],rd,wr)
    if rd>2500000 or wr>50000: print('⚠️ D1 무료 한도 50% 초과')
PY
cd "$(dirname "$0")/../worker"
SIZE=$(npx wrangler d1 info crewswap-db 2>/dev/null | grep database_size | awk -F'│' '{print $3}' | xargs)
echo "== D1 용량: $SIZE (무료 5GB)"
for u in https://api.rufnekcrew.com/api/health https://rufnek737.github.io/crewswap/ https://rufnekcrew.com/crewswap; do
  c=$(curl -s -o /dev/null -m 15 -w "%{http_code}" "$u"); echo "== $u → $c"
  case "$c" in 000|5*) echo "⚠️ 응답 없음/서버 오류: $u";; esac
done
EXP=$(curl -s https://rdap.verisign.com/com/v1/domain/rufnekcrew.com | python3 -c "import json,sys;print([e['eventDate'] for e in json.load(sys.stdin)['events'] if e['eventAction']=='expiration'][0][:10])")
DAYS=$(( ( $(date -j -f %Y-%m-%d "$EXP" +%s) - $(date +%s) ) / 86400 ))
echo "== 도메인 만료: $EXP ($DAYS일 남음)"
[ "$DAYS" -lt 60 ] && echo "⚠️ 도메인 만료 60일 이내"
true
