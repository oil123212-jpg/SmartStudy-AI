# SmartStudy 실제 배포 체크리스트

## 1. 배포에 포함할 파일

포함:

```text
assets/
index.html
style.css
app.js
server.py
schema.sql
requirements.txt
runtime.txt
Procfile
render.yaml
railway.json
README.md
DEPLOY_GUIDE.md
QUESTION_API_GUIDE.md
```

제외:

```text
.env
secrets.obfuscated.json
data/
__pycache__/
*.log
*.zip
smartstudy_major_general_calendar_webapp/
```

실제 서버에서는 API 키를 난독화 파일로 올리지 말고, Render/Railway 환경변수로 넣는 것을 권장합니다.

## 2. 필수 환경변수

```text
OPENROUTER_API_KEY=...
LLM_PROVIDER=openrouter
LLM_MODEL=openai/gpt-4o-mini
APP_PUBLIC_URL=https://배포된-주소
SMARTSTUDY_DB=영구디스크/smartstudy.sqlite3
ALLOW_OBFUSCATED_SECRETS=false
ALLOW_DB_BACKUP=false
```

선택 환경변수:

```text
QUESTION_LLM_MAX_TOKENS=9000
QUESTION_DOCUMENT_MAX_CHARS=18000
MAX_JSON_BODY_BYTES=1000000
MAX_UPLOAD_BYTES=30000000
MAX_UPLOAD_FILE_COUNT=5
SESSION_TTL_DAYS=30
```

DB 백업 API를 운영자가 임시로 켤 때만:

```text
ALLOW_DB_BACKUP=true
BACKUP_ADMIN_TOKEN=강한-임의-문자열
```

## 3. Render 배포 순서

1. GitHub 저장소에 배포 파일을 올립니다.
2. Render에서 New Web Service 또는 Blueprint 배포를 선택합니다.
3. `render.yaml`을 쓰면 persistent disk가 `/opt/render/project/src/data`에 붙습니다.
4. Render 환경변수에 `OPENROUTER_API_KEY`와 `APP_PUBLIC_URL`을 추가합니다.
5. 첫 배포 후 `https://배포주소/api/health`가 `ok: true`인지 확인합니다.
6. 회원가입 후 일정 생성, 로그아웃, 새 창 테스트를 합니다.

Render용 DB 경로:

```text
SMARTSTUDY_DB=/opt/render/project/src/data/smartstudy.sqlite3
```

## 4. Railway 배포 순서

1. Railway에서 Deploy from GitHub를 선택합니다.
2. Volume을 만들고 앱에 마운트합니다.
3. 예를 들어 volume mount path를 `/data`로 둡니다.
4. 환경변수에 아래를 넣습니다.

```text
SMARTSTUDY_DB=/data/smartstudy.sqlite3
OPENROUTER_API_KEY=...
LLM_PROVIDER=openrouter
LLM_MODEL=openai/gpt-4o-mini
APP_PUBLIC_URL=https://배포된-주소
ALLOW_OBFUSCATED_SECRETS=false
ALLOW_DB_BACKUP=false
```

5. 배포 후 `/api/health`에서 DB가 생성됐는지 확인합니다.

## 5. 배포 후 검증

```text
GET /api/health
GET /secrets.obfuscated.json  -> 404
GET /server.py                -> 404
POST /api/state 비로그인       -> 401
POST /api/questions/generate 비로그인 -> 401
회원가입 후 POST /api/state    -> 200
```

## 6. 운영 메모

- SQLite는 persistent disk가 없으면 재배포 때 데이터가 사라집니다.
- 여러 사용자가 많은 파일을 동시에 업로드하는 규모가 되면 PostgreSQL/Supabase 전환을 고려하세요.
- `secrets.obfuscated.json`은 로컬 편의용입니다. 실제 서버 비밀값은 플랫폼 환경변수를 사용하세요.
