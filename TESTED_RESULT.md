# Tested Result

This build was checked on the local SmartStudy server.

## Question Flow

- Server: `server.py`
- API flow:
  1. Upload PDF with `POST /api/questions/upload`
  2. Generate questions with `POST /api/questions/generate`
  3. Hide questions where `confidence === "low"`
  4. If an LLM API key exists but LLM generation fails, return an error instead of saving fallback questions.

```json
{
  "upload_ok": true,
  "question_count": 2,
  "visible_count": 2,
  "confidences": ["medium", "medium"]
}
```

## LLM Fallback Regression Check

- Compared with `smartstudy01-compact-question-layout-tested.zip`.
- `server.py` and `app.js` were identical before this fix, so the recent layout work was not the fallback cause.
- Cause found: the running local server could be launched in a restricted environment where external sockets are blocked. The old server swallowed that LLM exception and saved local fallback questions.
- Fix:
  - Keep local fallback only when no LLM API key exists.
  - When an API key exists, return `502` with the LLM error instead of saving fallback questions.
  - Replace the question-generation prompt path with a clean Korean prompt that requires the keyword to be directly represented.

```json
{
  "key_present": true,
  "llm_call_ok": true,
  "fallback": false,
  "endpoint_status": 200
}
```

## Generic Question Guard

The generator now rejects broad meta-questions such as:

`목표의 정의와 적용 조건을 밝히고, PDF 문맥에서 이 개념이 필요한 이유를 설명하시오.`

```json
{
  "generic_flag": true,
  "generic_blocked": true,
  "error": "포괄적 정의/설명형 문제를 차단했습니다."
}
```

## Answer-Leak Guard And API Check

- OpenRouter key loading was verified without printing the key.
- Actual API probe returned valid JSON.
- Default model is now `openai/gpt-4o-mini` unless `LLM_MODEL` or `OPENROUTER_MODEL` is set.
- The generator rejects question stems that define or explain the answer first and then ask what it means.
- The generator also rejects overly long or repeated-case question stems, then retries once with a stricter prompt.

```json
{
  "key_present": true,
  "llm_call_ok": true,
  "model": "openai/gpt-4o-mini",
  "answer_leak_blocked": true,
  "repeated_case_blocked": true,
  "real_generation_status": 200,
  "real_generation_leak_flag": false,
  "real_generation_repeat_flag": false
}
```

## Login-Gated Question Records

Question-generation records are now saved only for authenticated users.

```json
{
  "unauth_generate_status": 401,
  "unauth_materials_status": 401,
  "unauth_sets_status": 401,
  "question_table_counts_unchanged_after_unauth_generate": true,
  "new_login_sees_existing_anonymous_sets": 0,
  "removed_existing_anonymous_materials": 2,
  "removed_existing_anonymous_sets": 6,
  "removed_existing_anonymous_upload_files": 2
}
```

## Login-Gated Calendar Records And DB Hardening

- Guest calendar state now uses `sessionStorage`, not `localStorage`.
- `POST /api/state`, `GET /api/state`, `GET /api/export`, and `POST /api/backup` require login.
- Legacy global DB tables `app_state` and `state_history` are removed during DB initialization.
- `question_materials` and `question_sets` require `user_id` at the DB trigger level.
- New passwords use PBKDF2-SHA256 hashes; legacy SHA-256 hashes are upgraded on successful login.
- `secrets.obfuscated.json` was rewritten to the v2 PBKDF2/HMAC stream format.

```json
{
  "unauth_state_status": 401,
  "unauth_backup_status": 401,
  "calendar_rows_unchanged_after_unauth_state": true,
  "legacy_tables_removed": true,
  "anonymous_question_rows": 0,
  "null_user_question_insert_blocked": true,
  "authenticated_calendar_save_status": 200,
  "password_hash_scheme": "pbkdf2_sha256",
  "obfuscated_secret_version": 2
}
```

## Server Hardening Pass

- JSON body size is limited by `MAX_JSON_BODY_BYTES`.
- Multipart upload size and file count are limited by `MAX_UPLOAD_BYTES` and `MAX_UPLOAD_FILE_COUNT`.
- Expired sessions are pruned during DB initialization using `SESSION_TTL_DAYS`.
- `POST /api/backup` is disabled unless `ALLOW_DB_BACKUP=true`; deployed backups also require `BACKUP_ADMIN_TOKEN`.
- Static file serving now exposes only the app shell and assets, blocking `.env`, `server.py`, `schema.sql`, `secrets.obfuscated.json`, DB folders, logs, and docs.
- Legacy sub-app folders are not exposed by the static server.
- Static and JSON responses include basic security headers.

```json
{
  "oversized_json_status": 413,
  "invalid_json_status": 400,
  "secret_static_status": 404,
  "server_source_static_status": 404,
  "legacy_subapp_static_status": 404,
  "backup_default_status": 403,
  "health_reports_guest_persistence": "sessionStorage_only"
}
```

## Script Cleanup And Speed Pass

- Removed duplicate legacy question-generation function blocks from `server.py`; only the validated generator remains.
- Fixed outdated profile copy so it matches the current login-only calendar/question persistence policy.
- `ensure_db()` now runs schema/migration work once per server process and returns from cache after that.
- Frontend autosave interval was relaxed from `1200ms` to `3000ms`; explicit saves and `beforeunload` still protect changes.
- LLM calls now pass bounded `max_tokens`, scaled separately for keyword extraction and question generation.
- Static asset scan found no missing local assets after cache-buster query strings were normalized.

```json
{
  "server_question_generator_definitions": {
    "normalize_question_item": 1,
    "build_questions_with_llm": 1,
    "build_questions": 1
  },
  "ensure_db_cached_ms": 0.001,
  "health_median_ms": 3.54,
  "missing_assets": [],
  "state_unauth_status": 401,
  "question_generate_unauth_status": 401
}
```

## Deployment Preparation

- Added `DEPLOYMENT_CHECKLIST.md` with include/exclude files, Render/Railway steps, required env vars, and post-deploy checks.
- Deploy mode no longer auto-loads `secrets.obfuscated.json` unless `ALLOW_OBFUSCATED_SECRETS=true`.
- `APP_PUBLIC_URL` can be set for OpenRouter referer metadata in production.
- `.gitignore` now excludes local DB, uploads, logs, zip files, and `secrets.obfuscated.json`.
- Deployment package excludes `data/`, logs, cache folders, old sub-app copy, and obfuscated secrets.

```json
{
  "deploy_mode_without_env_key_loads_obfuscated_secret": false,
  "deploy_mode_requires_platform_env_key": true,
  "py_compile": true,
  "node_check": true,
  "clean_deploy_package_excludes_secrets": true
}
```

## Compact Layout Check

- Local URL: `http://127.0.0.1:8020`
- Viewport used by the in-app browser: `1280 x 720`
- Question tab layout:
  - Input panel is above the generated question panel.
  - Problem grid uses two columns: `436.5px 436.5px`
  - Two generated problem cards are fully visible in the viewport.
- Header login button:
  - Text remains on one line with `white-space: nowrap`
- Today study layout:
  - Calendar panel width: `625px`
  - Day-detail panel width: `300px`
  - Calendar share of the two-panel area: `0.68`

```json
{
  "problem_cards_fully_visible": 2,
  "problem_card_size": {
    "width": 437,
    "height": 100
  },
  "problem_card_y": 618,
  "question_input_above_output": true,
  "today_calendar_width_ratio": 0.68
}
```
