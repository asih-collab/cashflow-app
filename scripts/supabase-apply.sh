#!/usr/bin/env bash
# Supabase のスキーマ（supabase/migrations/*.sql）と Auth 設定（supabase/auth-config.json）を
# Management API（api.supabase.com）で反映する。
#
# 使い方:
#   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=xxxx scripts/supabase-apply.sh
#   （Claude のクラウド環境では api.supabase.com への認証がプロキシで自動付与されるため、トークンの環境変数は不要）
#
# 反映後に 1 度だけ手で行うこと（本人のメールアドレスをリポジトリに置かないため）:
#   insert into private.allowed_emails (email) values ('<本人のメールアドレス>');
set -euo pipefail
cd "$(dirname "$0")/.."

REF="${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF（プロジェクトの ref）を指定してください}"
API="https://api.supabase.com/v1/projects/${REF}"
AUTH=()
if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ]; then AUTH=(-H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}"); fi

for f in supabase/migrations/*.sql; do
  echo "== apply $f"
  python3 -c 'import json,sys; print(json.dumps({"query": open(sys.argv[1]).read()}))' "$f" \
    | curl -sS --fail-with-body -X POST "${API}/database/query" "${AUTH[@]}" -H 'Content-Type: application/json' -d @-
  echo
done

echo "== auth config (URL など)"
python3 -c 'import json; d=json.load(open("supabase/auth-config.json")); print(json.dumps({k: d[k] for k in ["site_url","uri_allow_list","external_email_enabled","mailer_autoconfirm","mailer_otp_length","mailer_otp_exp"]}))' \
  | curl -sS --fail-with-body -X PATCH "${API}/config/auth" "${AUTH[@]}" -H 'Content-Type: application/json' -d @- \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print({k: d.get(k) for k in ["site_url","mailer_otp_length","disable_signup"]})'
echo "== auth config (メール文面。無料プラン + 標準メール送信では 400 になる。独自 SMTP 設定後に有効)"
python3 -c 'import json; d=json.load(open("supabase/auth-config.json")); print(json.dumps({k: d[k] for k in ["mailer_subjects_magic_link","mailer_templates_magic_link_content"]}))' \
  | curl -sS -X PATCH "${API}/config/auth" "${AUTH[@]}" -H 'Content-Type: application/json' -d @- | head -c 300; echo
echo "done"
