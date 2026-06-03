# 배포 가이드

이 버전은 로컬 수정과 배포를 둘 다 고려한 구조입니다.

## 로컬에서 수정/실행

압축을 푼 폴더에서 실행합니다.

```bash
python server.py
```

Windows에서 `python` 명령이 안 되면:

```bash
py server.py
```

접속 주소:

```text
http://127.0.0.1:8020
```

수정할 파일:

```text
index.html   화면 구조
style.css    디자인
app.js       프론트 기능
server.py    서버/API/SQLite 저장
```

## Render 배포

방법 1: 대시보드에서 직접 생성

1. GitHub에 이 폴더를 업로드합니다.
2. Render에서 New Web Service를 선택합니다.
3. Start Command에 아래를 입력합니다.

```bash
python server.py
```

4. Environment Variable을 추가합니다.

```text
SMARTSTUDY_DB=/opt/render/project/src/data/smartstudy.sqlite3
LLM_PROVIDER=openrouter
LLM_MODEL=openai/gpt-4o-mini
OPENROUTER_API_KEY=...
APP_PUBLIC_URL=https://배포된-주소
ALLOW_DB_BACKUP=false
ALLOW_OBFUSCATED_SECRETS=false
```

5. Disk를 추가하고 mount path를 아래처럼 설정합니다.

```text
/opt/render/project/src/data
```

방법 2: `render.yaml` 사용

이 폴더에는 `render.yaml`이 포함되어 있어 Blueprint 방식으로도 배포할 수 있습니다.

## Railway 배포

1. GitHub에 이 폴더를 업로드합니다.
2. Railway에서 Deploy from GitHub를 선택합니다.
3. 포함된 `railway.json`의 startCommand에 따라 `python server.py`로 실행됩니다.
4. Railway는 `PORT` 환경변수를 자동으로 넣어주며, 서버가 자동으로 해당 포트에 바인딩합니다.
5. Railway Volume을 `/data`에 마운트하고 `SMARTSTUDY_DB=/data/smartstudy.sqlite3`로 지정합니다.

## 포함된 배포용 파일

```text
Procfile        Heroku/Railway 계열 실행 명령
render.yaml     Render Blueprint 설정
railway.json    Railway 설정
runtime.txt     Python 버전 힌트
.env.example    로컬 환경변수 예시
requirements.txt 의존성 안내
```

## SQLite 주의점

SQLite는 데모, 개인용, 소규모 프로젝트에는 간단해서 좋습니다. 배포할 때는 반드시 플랫폼의 persistent disk를 `data` 폴더에 연결하고, `SMARTSTUDY_DB`를 그 디스크 안의 경로로 지정하세요.

현재 서버는 사용자별 테이블만 사용합니다.

```text
users
auth_sessions
user_calendar_state
question_materials
question_sets
```

비로그인 사용자의 일정은 DB에 저장하지 않고 브라우저 `sessionStorage`에만 둡니다. 여러 사용자가 동시에 쓰는 서비스로 확장할 경우에는 Supabase/PostgreSQL 같은 외부 DB로 바꾸는 편이 좋습니다.

배포 환경에서는 DB 백업 API가 기본 비활성화되어 있습니다. 운영자가 임시로 필요할 때만 `ALLOW_DB_BACKUP=true`와 `BACKUP_ADMIN_TOKEN`을 함께 지정하세요.

실제 서버에는 `secrets.obfuscated.json`을 올리지 않는 것을 권장합니다. OpenRouter 키는 `OPENROUTER_API_KEY` 환경변수로 넣으세요.

운영 제한값은 필요에 맞게 조정할 수 있습니다.

```text
MAX_JSON_BODY_BYTES=1000000
MAX_UPLOAD_BYTES=30000000
MAX_UPLOAD_FILE_COUNT=5
SESSION_TTL_DAYS=30
```
