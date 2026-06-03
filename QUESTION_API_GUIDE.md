# 예상 문제 생성 API 경로

이 버전은 예상문제 탭에 PDF 키워드 대표문제 생성기를 임시 통합한 상태입니다.
입력값은 PDF, 과목명, 학교급, 키워드 수, 페이지 범위, 추가 조건을 사용하며 학년 입력은 사용하지 않습니다.
`OPENROUTER_API_KEY` 또는 난독화된 `secrets.obfuscated.json` 값이 있으면 LLM으로 키워드와 대표문제를 생성합니다.
API 키가 있는데 LLM 호출이 실패하면 fallback 문제를 저장하지 않고 오류를 반환합니다.
업로드 자료와 생성 기록은 로그인한 사용자에게만 저장됩니다.
비로그인 상태에서는 업로드/문제 생성/저장 목록 API가 `401`을 반환합니다.

## 추가된 폴더

```text
data/uploads/        업로드한 강의자료 저장
data/smartstudy.sqlite3   SQLite DB
```

## 추가된 DB 테이블

```text
question_materials   업로드 자료, 추출 텍스트, 키워드 저장
question_sets        생성된 예상 문제 세트 저장
```

두 테이블은 `user_id`가 필수이며, DB 트리거로 `user_id` 없는 저장을 차단합니다.

## API 목록

### 1. 상태 확인

```http
GET /api/questions/health
```

### 2. 자료 업로드

```http
POST /api/questions/upload
Content-Type: multipart/form-data

pdfs: PDF 파일. 여러 개 가능
subject_id: 과목 ID 선택값
subject: 과목명
schoolLevel: middle_school | high_school | university
topN: 키워드 수
startPage: 시작 페이지
endPage: 끝 페이지. 생략 가능
userPrompt: 추가 조건
```

응답 예시:

```json
{
  "ok": true,
  "material_id": 1,
  "filename": "lecture.pdf",
  "selectedPageRange": "1-12",
  "textLength": 18220,
  "keywords": ["미분", "극한", "접평면"]
}
```

### 3. 키워드 추출

```http
POST /api/questions/extract-keywords
Content-Type: application/json

{
  "text": "자료 텍스트",
  "limit": 15
}
```

또는 업로드 자료 기준:

```json
{
  "material_id": 1,
  "limit": 15
}
```

### 4. 공개자료 검색 슬롯

```http
POST /api/questions/search-sources
Content-Type: application/json

{
  "keywords": ["극한", "미분가능성"]
}
```

현재는 실제 웹 검색이 아니라, 나중에 Google Custom Search, SerpAPI, 학교 기출 DB 등을 붙일 자리만 만들어둔 상태입니다.

### 5. 문제 생성

```http
POST /api/questions/generate
Content-Type: application/json

{
  "subject_id": "sub_math",
  "subject": "미적분학",
  "school_level": "university",
  "user_prompt": "계산형보다 개념 적용형으로",
  "material_id": 1,
  "title": "미적분학 키워드별 대표문제",
  "keywords": ["극한", "미분가능성"],
  "count": 2,
  "question_type": "representative",
  "difficulty": "medium",
  "sources": []
}
```

`question_type`은 임시 통합 버전에서 `representative`를 사용합니다.

`difficulty` 값:

```text
low, medium, high
```

### 6. 업로드 자료 목록

```http
GET /api/questions/materials
```

### 7. 생성 문제 세트 목록

```http
GET /api/questions/sets
```

## 실제 AI 연결 위치

`server.py`의 아래 함수들이 임시 통합 지점입니다.

```python
extract_keywords_with_llm()
build_questions_with_llm()
```

예상 흐름:

```text
자료 업로드
→ extract_keywords에서 AI 또는 NLP로 키워드 추출
→ search-sources에서 공개 기출/자료 검색
→ build_questions에서 키워드 + 검색자료 + 과목정보를 종합해 문제 생성
→ question_sets 테이블 저장
```
