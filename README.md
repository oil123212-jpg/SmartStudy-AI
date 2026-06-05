# SmartStudy AI 서버 + SQLite + 배포 준비 버전

이 프로젝트는 로컬에서 바로 수정하면서 실행할 수 있고, Render/Railway 같은 플랫폼에 배포할 수 있도록 기본 설정 파일을 포함합니다.

## 로컬 실행

```bash
python server.py
```

Windows에서 안 되면:

```bash
py server.py
```

브라우저 접속:

```text
http://127.0.0.1:8020
```

## 로컬 수정 파일

```text
index.html   화면 구조
style.css    디자인
app.js       프론트 기능
server.py    서버/API/SQLite 저장
```

## DB 저장 위치

기본값:

```text
data/smartstudy.sqlite3
```

서버를 처음 실행하면 자동으로 생성됩니다.

## API

- `GET /api/health`: 서버/DB 상태 확인
- `GET /api/state`: 로그인 사용자의 저장 상태 불러오기
- `POST /api/state`: 로그인 사용자의 앱 상태 저장
- `POST /api/state/beacon`: 로그인 사용자의 창 닫기 직전 저장
- `GET /api/export`: 로그인 사용자의 저장 상태 JSON 내보내기
- `POST /api/backup`: 로그인 사용자만 호출 가능하며, 배포 환경에서는 기본 비활성화

## 배포

배포 설명은 `DEPLOY_GUIDE.md`와 `DEPLOYMENT_CHECKLIST.md`를 참고하세요.

포함된 배포용 파일:

```text
Procfile
render.yaml
railway.json
runtime.txt
.env.example
requirements.txt
```

## 예상 문제 생성 API 추가

이번 버전에는 `예상 문제 생성` 탭과 서버 API 경로가 추가되어 있습니다.

- 자료 업로드: `POST /api/questions/upload`
- 키워드 추출: `POST /api/questions/extract-keywords`
- 공개자료 검색 슬롯: `POST /api/questions/search-sources`
- 문제 생성: `POST /api/questions/generate`
- 업로드 자료 목록: `GET /api/questions/materials`
- 생성 문제 세트 목록: `GET /api/questions/sets`

자세한 내용은 `QUESTION_API_GUIDE.md`를 확인하세요.

### PDF 키워드 대표문제 임시 통합

예상문제 탭은 PDF 키워드 대표문제 생성기 입력값을 기준으로 임시 통합되어 있습니다.

- 입력: PDF 파일, 과목명, 학교급, 키워드 수, 페이지 범위, 추가 조건
- 출력: 키워드 목록, 문제 목록, 정답 단락, 해설 단락
- API 키: 환경변수 또는 `secrets.obfuscated.json`의 난독화 값을 사용합니다.
- PDF 추출: `pypdf`를 사용합니다. `run_server.bat` 실행 시 없으면 `requirements.txt`로 설치합니다.

## 저장 정책

- 로그인한 사용자의 일정과 예상문제 기록만 SQLite DB에 저장됩니다.
- 비로그인 상태의 일정은 브라우저 `sessionStorage`에만 임시 저장되어 창을 닫으면 사라집니다.
- 전역 상태 저장 테이블은 사용하지 않으며, `schema.sql`은 사용자별 저장 구조만 포함합니다.
- 서버는 JSON 요청 크기, PDF 업로드 크기, 업로드 파일 개수, 세션 보관 기간을 환경변수로 제한합니다.
- 정적 파일 서버는 앱 실행에 필요한 HTML/CSS/JS/assets만 노출하고, `.env`, `server.py`, `secrets.obfuscated.json`, DB 폴더는 직접 접근을 막습니다.
- 서버 스키마 초기화는 프로세스 시작 후 1회만 실행되고, LLM 응답 토큰 상한은 `QUESTION_LLM_MAX_TOKENS`로 조절합니다.
