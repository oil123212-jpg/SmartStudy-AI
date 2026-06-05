#!/usr/bin/env python3
# SmartStudy AI local server - Python standard library only
# 실행: python server.py  (브라우저: http://127.0.0.1:8020)

import hashlib
import base64
import hmac
import io
import json
import mimetypes
import re
import os
import shutil
import secrets
import sqlite3
import threading
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
from urllib import request as urlrequest
from urllib import error as urlerror

BASE_DIR = Path(__file__).resolve().parent


def load_env_file() -> None:
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def _b64url_decode(value: str) -> bytes:
    raw = str(value or "").encode("ascii", errors="ignore")
    raw += b"=" * (-len(raw) % 4)
    return base64.urlsafe_b64decode(raw)


def _derive_obfuscation_stream(salt: str, nonce: str, length: int) -> bytes:
    seed = hashlib.pbkdf2_hmac("sha256", salt.encode("utf-8"), nonce.encode("utf-8"), 120_000, dklen=32)
    chunks = []
    counter = 0
    while sum(len(chunk) for chunk in chunks) < length:
        chunks.append(hmac.new(seed, counter.to_bytes(4, "big") + nonce.encode("utf-8"), hashlib.sha256).digest())
        counter += 1
    return b"".join(chunks)[:length]


def decode_obfuscated_value(encoded, salt: str) -> str:
    if isinstance(encoded, dict) and encoded.get("v") == 2:
        try:
            nonce = str(encoded.get("nonce") or "")
            cipher = _b64url_decode(str(encoded.get("data") or ""))
            stream = _derive_obfuscation_stream(salt, nonce, len(cipher))
            plain = bytes(b ^ stream[i] for i, b in enumerate(cipher))
            checksum = hashlib.sha256(plain + salt.encode("utf-8")).hexdigest()[:24]
            if not hmac.compare_digest(checksum, str(encoded.get("sha256") or "")):
                return ""
            return plain.decode("utf-8", errors="ignore")
        except Exception:
            return ""

    joined = "".join(encoded) if isinstance(encoded, list) else str(encoded or "")
    if not joined or not salt:
        return ""
    try:
        reversed_value = joined[::-1]
        xored = base64.b64decode(reversed_value).decode("utf-8", errors="ignore")
        return "".join(chr(ord(ch) ^ ord(salt[i % len(salt)])) for i, ch in enumerate(xored))
    except Exception:
        return ""


def load_obfuscated_env() -> None:
    is_deploy_env = "PORT" in os.environ or "RENDER" in os.environ or "RAILWAY_ENVIRONMENT" in os.environ
    allow_in_deploy = str(os.environ.get("ALLOW_OBFUSCATED_SECRETS") or "").lower() in {"1", "true", "yes", "on"}
    if is_deploy_env and not allow_in_deploy:
        return
    secret_path = BASE_DIR / "secrets.obfuscated.json"
    if not secret_path.exists():
        return
    try:
        config = json.loads(secret_path.read_text(encoding="utf-8"))
        salt = str(config.get("salt") or "")
        for key, encoded in (config.get("values") or {}).items():
            if not re.match(r"^[A-Z0-9_]+$", key):
                continue
            if key in os.environ:
                continue
            value = decode_obfuscated_value(encoded, salt).strip()
            if value:
                os.environ[key] = value
        if not os.environ.get("LLM_API_KEY") and os.environ.get("OPENROUTER_API_KEY"):
            os.environ["LLM_API_KEY"] = os.environ["OPENROUTER_API_KEY"]
        if not os.environ.get("OPENROUTER_API_KEY") and os.environ.get("LLM_API_KEY"):
            os.environ["OPENROUTER_API_KEY"] = os.environ["LLM_API_KEY"]
    except Exception as exc:
        print(f"Could not load obfuscated env: {exc}")


def normalize_llm_env_aliases() -> None:
    serial_code = os.environ.get("LLM_SERIAL_CODE") or os.environ.get("OPENROUTER_SERIAL_CODE")
    if serial_code and not os.environ.get("LLM_API_KEY"):
        os.environ["LLM_API_KEY"] = serial_code
    if serial_code and not os.environ.get("OPENROUTER_API_KEY"):
        os.environ["OPENROUTER_API_KEY"] = serial_code
    if not os.environ.get("LLM_API_KEY") and os.environ.get("OPENROUTER_API_KEY"):
        os.environ["LLM_API_KEY"] = os.environ["OPENROUTER_API_KEY"]
    if not os.environ.get("OPENROUTER_API_KEY") and os.environ.get("LLM_API_KEY"):
        os.environ["OPENROUTER_API_KEY"] = os.environ["LLM_API_KEY"]


load_env_file()
load_obfuscated_env()
normalize_llm_env_aliases()

DATA_DIR = BASE_DIR / "data"
BACKUP_DIR = DATA_DIR / "backups"
UPLOAD_DIR = DATA_DIR / "uploads"
_DB_ENV = os.environ.get("SMARTSTUDY_DB")
DB_PATH = Path(_DB_ENV) if _DB_ENV else (DATA_DIR / "smartstudy.sqlite3")
if not DB_PATH.is_absolute():
    DB_PATH = BASE_DIR / DB_PATH
IS_DEPLOY = "PORT" in os.environ or "RENDER" in os.environ or "RAILWAY_ENVIRONMENT" in os.environ
HOST = os.environ.get("HOST", "0.0.0.0" if IS_DEPLOY else "127.0.0.1")
PORT = int(os.environ.get("PORT", "8020"))
APP_PUBLIC_URL = os.environ.get("APP_PUBLIC_URL") or f"http://localhost:{PORT}"
ALLOW_DB_BACKUP = str(os.environ.get("ALLOW_DB_BACKUP") or "").lower() in {"1", "true", "yes", "on"}
BACKUP_ADMIN_TOKEN = str(os.environ.get("BACKUP_ADMIN_TOKEN") or "")
QUESTION_LLM_MODEL = os.environ.get("LLM_MODEL") or os.environ.get("OPENROUTER_MODEL") or "openai/gpt-4o-mini"
QUESTION_LLM_TIMEOUT = max(20, min(int(os.environ.get("LLM_TIMEOUT_SECONDS", "90") or 90), 180))
QUESTION_CONTEXT_CHARS = max(6000, min(int(os.environ.get("QUESTION_DOCUMENT_MAX_CHARS", "18000") or 18000), 40000))
QUESTION_LLM_MAX_TOKENS = max(800, min(int(os.environ.get("QUESTION_LLM_MAX_TOKENS", "9000") or 9000), 20000))
PASSWORD_HASH_ITERATIONS = max(120_000, int(os.environ.get("PASSWORD_HASH_ITERATIONS", "260000") or 260000))
MAX_STATE_JSON_BYTES = max(100_000, int(os.environ.get("MAX_STATE_JSON_BYTES", "2000000") or 2000000))
MAX_JSON_BODY_BYTES = max(32_000, int(os.environ.get("MAX_JSON_BODY_BYTES", "1000000") or 1000000))
MAX_UPLOAD_BYTES = max(1_000_000, int(os.environ.get("MAX_UPLOAD_BYTES", "30000000") or 30000000))
MAX_UPLOAD_FILE_COUNT = max(1, min(int(os.environ.get("MAX_UPLOAD_FILE_COUNT", "5") or 5), 20))
SESSION_TTL_DAYS = max(1, int(os.environ.get("SESSION_TTL_DAYS", "30") or 30))
QUESTION_SET_RETENTION_DAYS = max(1, int(os.environ.get("QUESTION_SET_RETENTION_DAYS", "30") or 30))
PUBLIC_ROOT_FILES = {"index.html", "app.js", "style.css"}
PUBLIC_STATIC_EXTS = {".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico", ".woff", ".woff2"}
PRIVATE_STATIC_NAMES = {
    ".env", ".env.example", ".gitignore", "server.py", "schema.sql", "secrets.obfuscated.json",
    "README.md", "DEPLOY_GUIDE.md", "QUESTION_API_GUIDE.md", "TESTED_RESULT.md",
    "Procfile", "render.yaml", "railway.json", "runtime.txt", "requirements.txt",
}


class RequestError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


_DB_READY = False
_DB_LOCK = threading.Lock()


def db_connect():
    """SQLite 연결을 한 곳에서 관리합니다.
    ThreadingHTTPServer의 자동저장 요청이 겹쳐도 DB 잠금 오류가 덜 나도록
    timeout/busy_timeout/WAL 모드를 기본 적용합니다.
    """
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 15000")
    conn.execute("PRAGMA synchronous = NORMAL")
    try:
        conn.execute("PRAGMA journal_mode = WAL")
    except sqlite3.OperationalError:
        # 일부 환경에서는 WAL 전환이 실패할 수 있으므로 서버 실행 자체는 유지합니다.
        pass
    return conn


def ensure_column(conn, table: str, column: str, alter_sql: str) -> None:
    existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in existing:
        conn.execute(alter_sql)


def ensure_db() -> None:
    global _DB_READY
    if _DB_READY:
        return
    with _DB_LOCK:
        if _DB_READY:
            return
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        with db_connect() as conn:
            _ensure_db_schema(conn)
            conn.commit()
        _DB_READY = True


def _ensure_db_schema(conn) -> None:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_calendar_state (
                user_id INTEGER PRIMARY KEY,
                state_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS auth_sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS question_materials (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                subject_id TEXT,
                original_filename TEXT NOT NULL,
                stored_filename TEXT NOT NULL,
                mime_type TEXT,
                size_bytes INTEGER NOT NULL DEFAULT 0,
                extracted_text TEXT,
                keywords_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS question_sets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                subject_id TEXT,
                title TEXT NOT NULL,
                keywords_json TEXT NOT NULL DEFAULT '[]',
                sources_json TEXT NOT NULL DEFAULT '[]',
                questions_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        ensure_column(conn, "question_materials", "user_id", "ALTER TABLE question_materials ADD COLUMN user_id INTEGER")
        ensure_column(conn, "question_sets", "user_id", "ALTER TABLE question_sets ADD COLUMN user_id INTEGER")
        ensure_column(conn, "question_sets", "last_viewed_at", "ALTER TABLE question_sets ADD COLUMN last_viewed_at TEXT")
        existing_tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if "app_state" in existing_tables:
            conn.execute("DROP TABLE app_state")
        if "state_history" in existing_tables:
            conn.execute("DROP TABLE state_history")
        conn.execute("DELETE FROM question_materials WHERE user_id IS NULL")
        conn.execute("DELETE FROM question_sets WHERE user_id IS NULL")
        cutoff = (datetime.now() - timedelta(days=SESSION_TTL_DAYS)).isoformat(timespec="seconds")
        conn.execute("DELETE FROM auth_sessions WHERE last_seen_at < ?", (cutoff,))
        question_cutoff = (datetime.now() - timedelta(days=QUESTION_SET_RETENTION_DAYS)).isoformat(timespec="seconds")
        conn.execute("UPDATE question_sets SET last_viewed_at = created_at WHERE last_viewed_at IS NULL OR last_viewed_at = ''")
        conn.execute("DELETE FROM question_sets WHERE COALESCE(NULLIF(last_viewed_at, ''), created_at) < ?", (question_cutoff,))
        conn.execute("CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_auth_sessions_last_seen ON auth_sessions(last_seen_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_question_materials_user_id ON question_materials(user_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_question_sets_user_id ON question_sets(user_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_question_sets_last_viewed ON question_sets(last_viewed_at)")
        conn.execute(
            """
            CREATE TRIGGER IF NOT EXISTS question_materials_user_required
            BEFORE INSERT ON question_materials
            WHEN NEW.user_id IS NULL
            BEGIN
                SELECT RAISE(ABORT, 'question_materials.user_id is required');
            END
            """
        )
        conn.execute(
            """
            CREATE TRIGGER IF NOT EXISTS question_sets_user_required
            BEFORE INSERT ON question_sets
            WHEN NEW.user_id IS NULL
            BEGIN
                SELECT RAISE(ABORT, 'question_sets.user_id is required');
            END
            """
        )

def password_hash(password: str, salt: str, iterations: int = PASSWORD_HASH_ITERATIONS) -> str:
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations)
    return f"pbkdf2_sha256${iterations}${digest.hex()}"


def verify_password(password: str, salt: str, stored_hash: str):
    stored_hash = str(stored_hash or "")
    if stored_hash.startswith("pbkdf2_sha256$"):
        try:
            _, iteration_text, digest_hex = stored_hash.split("$", 2)
            iterations = int(iteration_text)
        except Exception:
            return False, False
        expected = password_hash(password, salt, iterations)
        return hmac.compare_digest(expected, stored_hash), iterations < PASSWORD_HASH_ITERATIONS
    legacy = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
    return hmac.compare_digest(legacy, stored_hash), True


def public_user(row):
    return {"id": row["id"], "name": row["name"], "email": row["email"], "created_at": row["created_at"]}


def create_user(payload):
    name = str(payload.get("name") or "").strip() or "SmartStudy 사용자"
    email = str(payload.get("email") or "").strip().lower()
    password = str(payload.get("password") or "")
    if not email or not password:
        return 400, {"error": "이메일/아이디와 비밀번호가 필요합니다."}
    if len(password) < 4:
        return 400, {"error": "비밀번호는 4자 이상으로 입력해 주세요."}
    ensure_db()
    salt = secrets.token_hex(16)
    hashed = password_hash(password, salt)
    now = datetime.now().isoformat(timespec="seconds")
    try:
        with db_connect() as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.execute(
                "INSERT INTO users(name, email, password_salt, password_hash, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)",
                (name, email, salt, hashed, now, now),
            )
            conn.commit()
            row = conn.execute("SELECT id, name, email, created_at FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    except sqlite3.IntegrityError:
        return 409, {"error": "이미 가입된 이메일/아이디입니다."}
    token = create_session(row["id"])
    return 200, {"ok": True, "token": token, "user": public_user(row)}


def login_user(payload):
    email = str(payload.get("email") or "").strip().lower()
    password = str(payload.get("password") or "")
    ensure_db()
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not row:
        return 401, {"error": "로그인 정보가 올바르지 않습니다."}
    ok, needs_upgrade = verify_password(password, row["password_salt"], row["password_hash"])
    if not ok:
        return 401, {"error": "로그인 정보가 올바르지 않습니다."}
    if needs_upgrade:
        new_salt = secrets.token_hex(16)
        new_hash = password_hash(password, new_salt)
        now = datetime.now().isoformat(timespec="seconds")
        with db_connect() as conn:
            conn.execute(
                "UPDATE users SET password_salt = ?, password_hash = ?, updated_at = ? WHERE id = ?",
                (new_salt, new_hash, now, row["id"]),
            )
            conn.commit()
    token = create_session(row["id"])
    return 200, {"ok": True, "token": token, "user": public_user(row)}


def create_session(user_id: int) -> str:
    ensure_db()
    token = secrets.token_urlsafe(32)
    now = datetime.now().isoformat(timespec="seconds")
    with db_connect() as conn:
        conn.execute("INSERT INTO auth_sessions(token, user_id, created_at, last_seen_at) VALUES(?, ?, ?, ?)", (token, user_id, now, now))
        conn.commit()
    return token


def get_user_by_token(token: str):
    if not token:
        return None
    ensure_db()
    now = datetime.now().isoformat(timespec="seconds")
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT u.id, u.name, u.email, u.created_at
            FROM auth_sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token = ?
            """,
            (token,),
        ).fetchone()
        if row:
            conn.execute("UPDATE auth_sessions SET last_seen_at = ? WHERE token = ?", (now, token))
            conn.commit()
    return row


def logout_user(token: str):
    if token:
        ensure_db()
        with db_connect() as conn:
            conn.execute("DELETE FROM auth_sessions WHERE token = ?", (token,))
            conn.commit()
    return 200, {"ok": True}


def read_user_calendar_state(user_id: int):
    ensure_db()
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT state_json, updated_at FROM user_calendar_state WHERE user_id = ?", (user_id,)).fetchone()
    if not row:
        return {"state": None, "updated_at": None}
    try:
        state = json.loads(row["state_json"])
    except json.JSONDecodeError:
        state = None
    return {"state": state, "updated_at": row["updated_at"]}


def save_user_calendar_state(user_id: int, payload):
    state = payload.get("state") if isinstance(payload, dict) else None
    if not isinstance(state, dict):
        return 400, {"error": "state 객체가 필요합니다."}
    # 로그인 저장 대상은 캘린더/과목/일정 관련 필드만 허용합니다.
    allowed = {
        "categories", "subjects", "plans", "globalBlockedDates", "completionLog",
        "displayYear", "displayMonth", "weekStart", "calendarMode",
        "selectedAdjustCategoryId", "selectedAdjustSubjectId",
        "adjustDisplayYear", "adjustDisplayMonth", "adjustSelectedDate",
    }
    calendar_state = {k: v for k, v in state.items() if k in allowed}
    state_json = json.dumps(calendar_state, ensure_ascii=False)
    if len(state_json.encode("utf-8")) > MAX_STATE_JSON_BYTES:
        return 413, {"error": "저장할 일정 데이터가 너무 큽니다."}
    now = datetime.now().isoformat(timespec="seconds")
    ensure_db()
    with db_connect() as conn:
        conn.execute(
            """
            INSERT INTO user_calendar_state(user_id, state_json, created_at, updated_at)
            VALUES(?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              state_json = excluded.state_json,
              updated_at = excluded.updated_at
            """,
            (user_id, state_json, now, now),
        )
        conn.commit()
    return 200, {"ok": True, "updated_at": now}

def make_backup(backup_token=""):
    if not ALLOW_DB_BACKUP:
        return 403, {"error": "DB 백업 API가 비활성화되어 있습니다. 필요할 때만 ALLOW_DB_BACKUP=true로 켜세요."}
    if IS_DEPLOY and not BACKUP_ADMIN_TOKEN:
        return 403, {"error": "배포 환경의 DB 백업에는 BACKUP_ADMIN_TOKEN 설정이 필요합니다."}
    if BACKUP_ADMIN_TOKEN and not hmac.compare_digest(str(backup_token or ""), BACKUP_ADMIN_TOKEN):
        return 403, {"error": "DB 백업 관리자 토큰이 올바르지 않습니다."}
    ensure_db()
    if not DB_PATH.exists():
        return 404, {"error": "아직 생성된 DB가 없습니다."}
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = BACKUP_DIR / f"smartstudy_backup_{stamp}.sqlite3"
    shutil.copy2(DB_PATH, dest)
    return 200, {"ok": True, "file": str(dest.relative_to(BASE_DIR)).replace("\\\\", "/")}


# ===== 예상 문제 생성 API 보조 함수 =====
def safe_filename(name: str) -> str:
    name = Path(name or "upload.bin").name
    name = re.sub(r"[^0-9A-Za-z가-힣._-]+", "_", name).strip("._")
    return name or "upload.bin"


def normalize_positive_int(value, fallback=1):
    try:
        n = int(value)
        return n if n > 0 else fallback
    except Exception:
        return fallback


def clamp_int(value, low, high, fallback):
    try:
        n = int(value)
    except Exception:
        n = fallback
    return max(low, min(high, n))


def decode_text_bytes(data: bytes) -> str:
    for enc in ("utf-8", "cp949", "euc-kr", "latin-1"):
        try:
            return data.decode(enc, errors="ignore")[:300000]
        except Exception:
            continue
    return ""


def extract_pages_from_bytes(data: bytes, filename: str = ""):
    suffix = Path(filename).suffix.lower()
    if suffix in (".txt", ".md", ".csv", ".json", ".html", ".htm"):
        return [{"page": 1, "text": decode_text_bytes(data)}], None
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(data))
            pages = []
            for index, page in enumerate(reader.pages, start=1):
                text = page.extract_text() or ""
                pages.append({"page": index, "text": text})
            warning = None if any((p["text"] or "").strip() for p in pages) else "PDF 텍스트가 비어 있습니다. 스캔본이면 OCR이 필요할 수 있습니다."
            return pages, warning
        except ImportError:
            return [{"page": 1, "text": Path(filename).stem.replace("_", " ")}], "pypdf가 설치되지 않아 PDF 본문 대신 파일명 기반으로 처리했습니다."
        except Exception as exc:
            return [{"page": 1, "text": Path(filename).stem.replace("_", " ")}], f"PDF 텍스트 추출 실패: {exc}"
    return [{"page": 1, "text": Path(filename).stem.replace("_", " ")}], "지원되지 않는 파일 형식이라 파일명 기반으로 처리했습니다."


def extract_text_from_uploads(file_items, start_page=1, end_page=None):
    selected = []
    warnings = []
    file_infos = []
    global_page = 0
    start_page = normalize_positive_int(start_page, 1)
    end_page = normalize_positive_int(end_page, 0) if end_page not in (None, "") else None

    for item in file_items:
        filename = safe_filename(item.get("filename") or "upload.bin")
        pages, warning = extract_pages_from_bytes(item.get("data") or b"", filename)
        if warning:
            warnings.append(f"{filename}: {warning}")
        file_start = global_page + 1
        for page in pages:
            global_page += 1
            if global_page < start_page:
                continue
            if end_page and global_page > end_page:
                continue
            selected.append({
                "page": global_page,
                "local_page": page.get("page") or 1,
                "file_name": filename,
                "text": str(page.get("text") or "").strip(),
            })
        file_infos.append({"fileName": filename, "startPage": file_start, "endPage": global_page, "pageCount": max(0, global_page - file_start + 1)})

    if not selected and global_page:
        return extract_text_from_uploads(file_items, 1, None)

    blocks = []
    for page in selected:
        blocks.append(f"[page {page['page']} / {page['file_name']} p.{page['local_page']}]\n{page['text']}")

    return {
        "text": "\n\n".join(blocks).strip(),
        "pages": selected,
        "page_count": global_page,
        "selected_page_range": f"{start_page}-{end_page or global_page}",
        "file_infos": file_infos,
        "warnings": warnings,
    }


def extract_text_from_bytes(data: bytes, filename: str = "") -> str:
    pages, _warning = extract_pages_from_bytes(data, filename)
    return "\n\n".join(str(p.get("text") or "") for p in pages).strip()


def extract_keywords(text: str, limit: int = 15):
    text = text or ""
    stopwords = {
        "그리고", "그러나", "따라서", "대한", "에서", "으로", "하다", "있는", "없는",
        "the", "and", "for", "with", "that", "this", "from", "are", "was", "were",
        "chapter", "lecture", "slide", "page"
    }
    words = re.findall(r"[가-힣A-Za-z0-9]{2,}", text.lower())
    counts = {}
    for word in words:
        if word in stopwords or word.isdigit():
            continue
        counts[word] = counts.get(word, 0) + 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return [w for w, _ in ranked[:limit]]


def clean_compact(text: str, max_chars=18000) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()[:max_chars]


def question_api_key() -> str:
    return os.environ.get("LLM_API_KEY") or os.environ.get("OPENROUTER_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""


def extract_json_object(text: str):
    raw = str(text or "").strip()
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        pass
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.I)
    if fence:
        try:
            return json.loads(fence.group(1).strip())
        except Exception:
            pass
    start, end = raw.find("{"), raw.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(raw[start:end + 1])
        except Exception:
            pass
    return None


def call_question_llm_json(prompt: str, system_prompt: str, max_tokens=None):
    api_key = question_api_key()
    if not api_key:
        raise RuntimeError("LLM API 키가 없습니다.")
    provider = (os.environ.get("LLM_PROVIDER") or "openrouter").lower()
    base_url = os.environ.get("LLM_BASE_URL")
    if not base_url:
        base_url = "https://api.openai.com/v1" if provider == "openai" else "https://openrouter.ai/api/v1"
    url = base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": QUESTION_LLM_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.15,
        "max_tokens": max_tokens or QUESTION_LLM_MAX_TOKENS,
        "response_format": {"type": "json_object"},
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "HTTP-Referer": APP_PUBLIC_URL,
        "X-Title": "SmartStudy Question Generator",
    }
    req = urlrequest.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    try:
        with urlrequest.urlopen(req, timeout=QUESTION_LLM_TIMEOUT) as res:
            data = json.loads(res.read().decode("utf-8", errors="ignore"))
    except urlerror.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")[:500]
        raise RuntimeError(f"LLM 요청 실패: {exc.code} {detail}") from exc
    content = (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
    parsed = extract_json_object(content)
    if not parsed:
        raise RuntimeError("LLM이 JSON 형식의 결과를 반환하지 않았습니다.")
    return parsed


def extract_keywords_with_llm(text: str, subject="", school_level="", user_prompt="", limit=20):
    prompt = f"""
PDF 텍스트에서 시험에 직접 사용할 수 있는 짧은 키워드를 추출하라.

과목: {subject or "미지정"}
학교급: {school_level or "미지정"}
추가 조건: {user_prompt or "(없음)"}
요청 개수: {limit}

기준:
- 정의, 정리, 법칙, 공식, 원리, 방법, 조건, 성질, 핵심 개념을 우선한다.
- 문장형 목표나 긴 설명문은 제외하고 1~5어절의 명사구로 쓴다.
- PDF에 실제로 근거가 있는 키워드를 고른다.

JSON만 반환:
{{"keywords":[{{"term":"키워드","reason":"짧은 근거"}}]}}

PDF 텍스트:
\"\"\"{clean_compact(text, QUESTION_CONTEXT_CHARS)}\"\"\"
"""
    max_tokens = min(QUESTION_LLM_MAX_TOKENS, max(600, limit * 70))
    parsed = call_question_llm_json(prompt, "You extract concise Korean exam keywords from uploaded study material. Return valid JSON only.", max_tokens=max_tokens)
    items = parsed.get("keywords") if isinstance(parsed, dict) else []
    out = []
    for item in items or []:
        term = item.get("term") if isinstance(item, dict) else str(item)
        term = re.sub(r"\s+", " ", str(term or "")).strip()
        if term and term not in out:
            out.append(term)
    return out[:limit]


def focused_context(text: str, keywords, max_chars=18000):
    source = str(text or "")
    if not source:
        return ""
    blocks = []
    used = 0
    window = max(900, min(2200, max_chars // max(2, len(keywords or []))))
    for kw in keywords or []:
        term = str(kw or "").strip()
        if not term:
            continue
        for match in re.finditer(re.escape(term), source, re.I):
            start = max(0, match.start() - window)
            end = min(len(source), match.end() + window)
            block = source[start:end].strip()
            if block and block not in blocks:
                label = f"[keyword: {term}]\n{block}"
                if used + len(label) > max_chars and blocks:
                    break
                blocks.append(label)
                used += len(label)
                break
    return "\n\n".join(blocks).strip()[:max_chars] or source[:max_chars]


GENERIC_QUESTION_PATTERNS = (
    "정의와 적용 조건",
    "PDF 문맥에서 이 개념이 필요한 이유",
    "이 개념이 필요한 이유",
    "개념이 필요한 이유",
    "대표 상황을 바탕으로",
    "그 조건이 결론을 정당화하는 이유",
)


OPEN_END_REQUEST_RE = re.compile(
    r"(무엇을\s*의미|무엇을\s*뜻|무엇인가|무엇인지|설명하시오|서술하시오|밝히시오|논하시오)"
)

DEFINITION_LEAK_RE = re.compile(
    r"(?:은|는|이란|란)\s*.{10,180}?(?:이다|한다|말한다|의미한다|뜻한다)\s*[.。]\s*"
)


def is_answer_leaking_question(question: str, answer: str = "", keyword: str = "") -> bool:
    compact = re.sub(r"\s+", " ", str(question or "")).strip()
    if not compact:
        return True

    request = OPEN_END_REQUEST_RE.search(compact)
    if request:
        prefix = compact[:request.start()]
        if DEFINITION_LEAK_RE.search(prefix):
            return True
        term = re.escape(str(keyword or "").strip())
        if term and re.search(rf"{term}(?:\([^)]*\))?\s*(?:은|는|이란|란)\s*.{{8,180}}?(?:이다|한다|의미한다|뜻한다)", prefix):
            return True

    answer_sentence = re.split(r"[.。!?]\s*", str(answer or "").strip())[0]
    if len(answer_sentence) >= 30 and answer_sentence[:30] in compact and request:
        return True
    return False


def is_generic_question_text(question: str, answer: str = "", keyword: str = "") -> bool:
    compact = re.sub(r"\s+", " ", str(question or "")).strip()
    if not compact:
        return True
    if any(pattern in compact for pattern in GENERIC_QUESTION_PATTERNS):
        return True
    if re.search(r"정의.*적용\s*조건.*(설명|밝히|제시|이유)", compact):
        return True
    if re.search(r"PDF\s*문맥.*(필요한\s*이유|설명)", compact, re.I):
        return True
    if is_answer_leaking_question(compact, answer, keyword):
        return True
    return False


def has_repeated_question_units(question: str) -> bool:
    units = []
    for raw in re.split(r"[\n\r]+|(?<=[.?!])\s+", str(question or "")):
        unit = re.sub(r"^\s*\d+\s*[.)]\s*", "", raw).strip()
        unit = re.sub(r"\s+", " ", unit)
        if len(unit) >= 12:
            units.append(unit)
    if len(units) < 4:
        return False
    counts = {}
    for unit in units:
        counts[unit] = counts.get(unit, 0) + 1
        if counts[unit] >= 3:
            return True
    return len(set(units)) <= max(1, len(units) // 2)


def normalize_question_item(raw, keyword, number=1, difficulty="medium"):
    difficulty_labels = {"low": "하", "medium": "중", "high": "상"}
    if not isinstance(raw, dict):
        raise ValueError(f"{keyword}: LLM 응답 항목이 객체가 아닙니다.")
    question = str(raw.get("question") or "").strip()
    answer = str(raw.get("answer") or "").strip()
    explanation = str(raw.get("explanation") or "").strip()
    if not question:
        raise ValueError(f"{keyword}: LLM 응답에 문제 본문이 없습니다.")
    if is_generic_question_text(question, answer, keyword):
        raise ValueError(f"{keyword}: 포괄적 정의/설명형 또는 정답 선노출 문제를 차단했습니다.")
    if len(question) > 900:
        raise ValueError(f"{keyword}: 문제 본문이 지나치게 깁니다.")
    if has_repeated_question_units(question):
        raise ValueError(f"{keyword}: 반복 사례가 포함된 문제를 차단했습니다.")
    if len(re.findall(r"(?:^|\n)\s*\d+\s*[.)]", question)) > 6:
        raise ValueError(f"{keyword}: 선택지 또는 사례 수가 지나치게 많습니다.")
    if not answer:
        raise ValueError(f"{keyword}: LLM 응답에 정답이 없습니다.")
    if not explanation:
        raise ValueError(f"{keyword}: LLM 응답에 해설이 없습니다.")
    return {
        "number": number,
        "type": str(raw.get("representativePattern") or raw.get("type") or "대표문제"),
        "difficulty": difficulty_labels.get(difficulty, difficulty),
        "keyword": str(raw.get("keyword") or keyword),
        "question": question,
        "choices": raw.get("choices") if isinstance(raw.get("choices"), list) else [],
        "answer": answer,
        "explanation": explanation,
        "confidence": str(raw.get("confidence") or "medium"),
        "source_note": str(raw.get("referenceUse") or "PDF 문맥과 생성 프롬프트를 반영했습니다."),
    }


def build_questions_with_llm(keywords, text="", subject="", school_level="", user_prompt="", difficulty="medium"):
    context = focused_context(text, keywords, QUESTION_CONTEXT_CHARS)
    retry_note = ""
    last_error = None
    for attempt in range(2):
        retry_block = f"\n재생성 지시:\n{retry_note}\n" if retry_note else ""
        prompt = f"""
업로드된 PDF 문맥과 입력 정보를 근거로, 각 키워드를 대표하는 시험 예상문제 1개씩을 생성하라.

키워드:
{chr(10).join(f"{i+1}. {kw}" for i, kw in enumerate(keywords))}

과목: {subject or "미지정"}
학교급: {school_level or "미지정"}
난이도: {difficulty or "medium"}
추가 조건: {user_prompt or "(없음)"}

PDF 문맥:
\"\"\"{context or "PDF 문맥 없음"}\"\"\"
{retry_block}

출제 규칙:
- JSON만 반환한다.
- items 배열의 개수와 순서는 키워드와 정확히 일치해야 한다.
- 각 문제는 해당 keyword를 직접 대표하는 시험 문제여야 한다.
- 절대 만들면 안 되는 문제: "정의와 적용 조건을 밝히고, PDF 문맥에서 이 개념이 필요한 이유를 설명하시오" 같은 포괄적 설명형 문제.
- 절대 만들면 안 되는 문제: "투쟁-도피 반응은 지각된 위협에 대한 자동 반응이다. 투쟁-도피 반응의 유형은 무엇을 의미하는가?"처럼 문제 본문이 이미 정답/정의/해설을 설명한 뒤 다시 묻는 문항.
- "관련하여 설명하시오", "필요한 이유를 설명하시오", "대표 상황을 바탕으로 설명하시오"처럼 범위가 열린 문장을 쓰지 않는다.
- 문제에는 구체적인 조건, 자료, 수치, 사례, 명제, 판단 기준 중 하나 이상을 넣어 풀이 방향이 하나로 정해지게 한다.
- 문제 본문에는 풀이에 필요한 단서만 제시하고, keyword의 정의·정답·해설 문장은 answer와 explanation에만 둔다.
- 개념형 문제는 정의를 그대로 적지 말고 사례 판별, 조건 충족 여부, 비교 기준, 결과 예측 중 하나로 묻는다.
- 사례를 만들 때는 PDF 문맥의 대상과 상황을 우선 사용하고, PDF에 없는 갑작스러운 비유나 동떨어진 소재를 만들지 않는다.
- 수학/과학 문제는 변수 조건, 수치, 단위, 식, 실험 조건은 제시하되 정리나 개념의 결론 자체를 문제 안에서 먼저 알려 주지 않는다.
- 한 문항에는 사례나 선택지를 최대 4개까지만 사용하고, 같은 사례·문장을 반복하지 않는다.
- 문제 본문은 900자 이내로 작성한다.
- keyword와 무관한 계산, 그래프, 예시 문제를 만들지 않는다.
- 예: keyword가 "함수의 극한"이면 미분이나 그래프 개형 문제가 아니라 극한의 존재, 좌극한/우극한, 극한값 판단 등을 물어야 한다.
- 정답은 해당 과목 전공자가 보아도 인정할 정도로 엄밀해야 하며, 필요한 정의, 공식, 조건, 결론을 포함한다.
- 해설은 정답과 분리하고, 왜 그 풀이가 타당한지 설명한다.
- PDF 근거가 부족해 대표문제를 안정적으로 만들 수 없으면 confidence를 "low"로 둔다.

JSON schema:
{{"items":[{{"keyword":"키워드","representativePattern":"유형","question":"문제","answer":"엄밀한 정답","explanation":"해설","confidence":"high|medium|low","referenceUse":"PDF 반영 방식"}}]}}
"""
        try:
            max_tokens = min(QUESTION_LLM_MAX_TOKENS, max(1600, len(keywords) * 620))
            parsed = call_question_llm_json(prompt, "You are a rigorous Korean exam question writer. Return valid JSON only.", max_tokens=max_tokens)
            items = parsed.get("items") if isinstance(parsed, dict) else []
            if not isinstance(items, list) or len(items) < len(keywords):
                raise ValueError("LLM 응답의 문제 개수가 키워드 개수보다 적습니다.")
            by_key = {}
            for item in items:
                if isinstance(item, dict):
                    by_key[str(item.get("keyword") or "").replace(" ", "").lower()] = item
            questions = []
            for index, kw in enumerate(keywords, start=1):
                raw = by_key.get(str(kw).replace(" ", "").lower()) or items[index - 1]
                questions.append(normalize_question_item(raw, kw, index, difficulty))
            return questions
        except Exception as exc:
            last_error = exc
            if attempt == 0:
                retry_note = (
                    f"- 이전 응답 검증 실패: {exc}\n"
                    "- 탈락 사유에 해당하는 문항을 모두 새 문항으로 다시 작성한다.\n"
                    "- 문제 본문에 정답 정의를 먼저 설명하지 말고, 구체적 사례나 판단 조건으로만 묻는다."
                )
                continue
            raise
    raise last_error


def build_questions(keywords, count=None, question_type="representative", difficulty="medium", text="", subject="", school_level="", user_prompt=""):
    keywords = [str(k).strip() for k in (keywords or []) if str(k).strip()]
    if not keywords:
        raise RuntimeError("문제 생성에 사용할 키워드가 없습니다.")
    if count:
        keywords = keywords[:max(1, min(int(count or len(keywords)), 40))]
    if not question_api_key():
        raise RuntimeError("LLM API 키가 없어 대표문제를 생성할 수 없습니다.")
    try:
        return build_questions_with_llm(keywords, text, subject, school_level, user_prompt, difficulty)
    except Exception as exc:
        print(f"LLM question generation failed: {exc}")
        raise RuntimeError(f"LLM 문제 생성 실패: {exc}") from exc


def list_materials(user_id):
    ensure_db()
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT * FROM question_materials WHERE user_id = ? ORDER BY id DESC LIMIT 100", (user_id,)).fetchall()
    return [{
        "id": r["id"], "subject_id": r["subject_id"], "original_filename": r["original_filename"],
        "stored_filename": r["stored_filename"], "mime_type": r["mime_type"], "size_bytes": r["size_bytes"],
        "keywords": json.loads(r["keywords_json"] or "[]"), "created_at": r["created_at"]
    } for r in rows]


def cleanup_expired_question_sets():
    cutoff = (datetime.now() - timedelta(days=QUESTION_SET_RETENTION_DAYS)).isoformat(timespec="seconds")
    with db_connect() as conn:
        conn.execute("UPDATE question_sets SET last_viewed_at = created_at WHERE last_viewed_at IS NULL OR last_viewed_at = ''")
        conn.execute("DELETE FROM question_sets WHERE COALESCE(NULLIF(last_viewed_at, ''), created_at) < ?", (cutoff,))
        conn.commit()


def list_question_sets(user_id):
    ensure_db()
    cleanup_expired_question_sets()
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT id, subject_id, title, keywords_json, created_at, last_viewed_at
            FROM question_sets
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT 50
            """,
            (user_id,),
        ).fetchall()
    return [{
        "id": r["id"], "subject_id": r["subject_id"], "title": r["title"],
        "keywords": json.loads(r["keywords_json"] or "[]"),
        "created_at": r["created_at"],
        "last_viewed_at": r["last_viewed_at"],
    } for r in rows]


def read_question_set(user_id, set_id):
    ensure_db()
    cleanup_expired_question_sets()
    now = datetime.now().isoformat(timespec="seconds")
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM question_sets WHERE id = ? AND user_id = ?", (set_id, user_id)).fetchone()
        if not row:
            return None
        conn.execute("UPDATE question_sets SET last_viewed_at = ? WHERE id = ? AND user_id = ?", (now, set_id, user_id))
        conn.commit()
    return {
        "id": row["id"], "subject_id": row["subject_id"], "title": row["title"],
        "keywords": json.loads(row["keywords_json"] or "[]"),
        "sources": json.loads(row["sources_json"] or "[]"),
        "questions": json.loads(row["questions_json"] or "[]"),
        "created_at": row["created_at"],
        "last_viewed_at": now,
    }


def create_question_set(payload, user_id):
    ensure_db()
    cleanup_expired_question_sets()
    subject_id = str(payload.get("subject_id") or "")
    title = str(payload.get("title") or "예상 문제 세트")
    keywords = payload.get("keywords") or []
    if isinstance(keywords, str):
        keywords = [x.strip() for x in re.split(r"[\n,]+", keywords) if x.strip()]
    material_id = payload.get("material_id")
    material_text = str(payload.get("text") or payload.get("document_text") or "")
    if material_id and not material_text:
        ensure_db()
        with db_connect() as conn:
            row = conn.execute("SELECT extracted_text FROM question_materials WHERE id = ? AND user_id = ?", (material_id, user_id)).fetchone()
            material_text = row[0] if row else ""
    count = payload.get("count") or len(keywords)
    question_type = payload.get("question_type", "representative")
    difficulty = payload.get("difficulty", "medium")
    subject = str(payload.get("subject") or "")
    school_level = str(payload.get("school_level") or payload.get("schoolLevel") or "")
    user_prompt = str(payload.get("user_prompt") or payload.get("userPrompt") or "")
    sources = payload.get("sources") or []
    questions = build_questions(
        keywords,
        count=count,
        question_type=question_type,
        difficulty=difficulty,
        text=material_text,
        subject=subject,
        school_level=school_level,
        user_prompt=user_prompt,
    )
    now = datetime.now().isoformat(timespec="seconds")
    with db_connect() as conn:
        cur = conn.execute(
            "INSERT INTO question_sets(user_id, subject_id, title, keywords_json, sources_json, questions_json, created_at, last_viewed_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, subject_id, title, json.dumps(keywords, ensure_ascii=False), json.dumps(sources, ensure_ascii=False), json.dumps(questions, ensure_ascii=False), now, now),
        )
        conn.commit()
        set_id = cur.lastrowid
    return {
        "ok": True,
        "id": set_id,
        "title": title,
        "keywords": keywords,
        "question_count": len(questions),
        "created_at": now,
        "last_viewed_at": now,
        "subject": subject,
        "school_level": school_level,
        "material_id": material_id,
    }



def db_health():
    ensure_db()
    required = {
        "users", "auth_sessions", "user_calendar_state",
        "question_materials", "question_sets"
    }
    with db_connect() as conn:
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        tables = {r[0] for r in rows}
        missing = sorted(required - tables)
        counts = {
            "users": conn.execute("SELECT COUNT(*) FROM users").fetchone()[0],
            "sessions": conn.execute("SELECT COUNT(*) FROM auth_sessions").fetchone()[0],
            "calendar_states": conn.execute("SELECT COUNT(*) FROM user_calendar_state").fetchone()[0],
            "question_materials": conn.execute("SELECT COUNT(*) FROM question_materials").fetchone()[0],
            "question_sets": conn.execute("SELECT COUNT(*) FROM question_sets").fetchone()[0],
        }
    db_exists = DB_PATH.exists()
    return {
        "ok": not missing,
        "db": DB_PATH.name if IS_DEPLOY else str(DB_PATH),
        "db_exists": db_exists,
        "db_size_bytes": DB_PATH.stat().st_size if db_exists else 0,
        "missing_tables": missing,
        "counts": counts,
        "data_dir": str(DATA_DIR),
        "backup_enabled": ALLOW_DB_BACKUP,
        "guest_persistence": "sessionStorage_only",
    }


class SmartStudyHandler(BaseHTTPRequestHandler):
    server_version = "SmartStudyLocal/1.0"

    def log_message(self, fmt, *args):
        print("[%s] %s" % (datetime.now().strftime("%H:%M:%S"), fmt % args))

    def send_json(self, status, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_security_headers()
        self.end_headers()
        self.wfile.write(data)

    def send_security_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")

    def content_length(self, max_bytes):
        raw = self.headers.get("Content-Length", "0") or "0"
        try:
            length = int(raw)
        except ValueError:
            raise RequestError(400, "Content-Length가 올바르지 않습니다.")
        if length < 0:
            raise RequestError(400, "Content-Length가 올바르지 않습니다.")
        if length > max_bytes:
            raise RequestError(413, "요청 데이터가 너무 큽니다.")
        return length

    def read_json_body(self):
        length = self.content_length(MAX_JSON_BODY_BYTES)
        raw = self.rfile.read(length) if length else b"{}"
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise RequestError(400, f"JSON 형식이 올바르지 않습니다: {exc.msg}")

    def get_auth_token(self):
        auth = self.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            return auth.split(" ", 1)[1].strip()
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        return (query.get("token") or [""])[0]

    def require_user(self):
        token = self.get_auth_token()
        row = get_user_by_token(token)
        if not row:
            self.send_json(401, {"error": "로그인이 필요합니다."})
            return None, token
        return row, token

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/health":
            try:
                return self.send_json(200, db_health())
            except Exception as exc:
                return self.send_json(500, {"ok": False, "error": str(exc), "db": str(DB_PATH)})
        if path == "/api/auth/me":
            row, token = self.require_user()
            if not row: return
            return self.send_json(200, {"ok": True, "user": public_user(row)})
        if path == "/api/state":
            row, token = self.require_user()
            if not row: return
            return self.send_json(200, read_user_calendar_state(row["id"]))
        if path == "/api/export":
            row, token = self.require_user()
            if not row: return
            payload = read_user_calendar_state(row["id"]).get("state") or {}
            return self.send_json(200, payload)
        if path == "/api/questions/health":
            ensure_db()
            return self.send_json(200, {"ok": True, "routes": [
                "POST /api/questions/upload",
                "POST /api/questions/extract-keywords",
                "POST /api/questions/search-sources",
                "POST /api/questions/generate",
                "GET /api/questions/materials",
                "GET /api/questions/sets",
                "GET /api/questions/sets/{id}"
            ]})
        if path == "/api/questions/materials":
            row, token = self.require_user()
            if not row: return
            return self.send_json(200, {"materials": list_materials(row["id"])})
        match = re.match(r"^/api/questions/sets/(\d+)$", path)
        if match:
            row, token = self.require_user()
            if not row: return
            question_set = read_question_set(row["id"], int(match.group(1)))
            if not question_set:
                return self.send_json(404, {"error": "저장된 예상문제를 찾을 수 없습니다."})
            return self.send_json(200, {"set": question_set})
        if path == "/api/questions/sets":
            row, token = self.require_user()
            if not row: return
            return self.send_json(200, {"sets": list_question_sets(row["id"])})

        return self.serve_static(path)

    def do_POST(self):
        try:
            return self.route_POST()
        except RequestError as exc:
            return self.send_json(exc.status, {"error": exc.message})
        except Exception as exc:
            print(f"Unhandled POST error: {exc}")
            return self.send_json(500, {"error": "서버 처리 중 오류가 발생했습니다."})

    def route_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path in ("/api/auth/register", "/api/auth/signup", "/register", "/signup"):
            status, obj = create_user(self.read_json_body())
            return self.send_json(status, obj)
        if path == "/api/auth/login":
            status, obj = login_user(self.read_json_body())
            return self.send_json(status, obj)
        if path == "/api/auth/logout":
            status, obj = logout_user(self.get_auth_token())
            return self.send_json(status, obj)
        if path in ("/api/state", "/api/state/beacon"):
            row, token = self.require_user()
            if not row: return
            status, obj = save_user_calendar_state(row["id"], self.read_json_body())
            return self.send_json(status, obj)
        if path == "/api/backup":
            row, token = self.require_user()
            if not row: return
            status, obj = make_backup(self.headers.get("X-Backup-Token", ""))
            return self.send_json(status, obj)
        if path == "/api/questions/upload":
            row, token = self.require_user()
            if not row: return
            return self.handle_question_upload(row["id"])
        if path == "/api/questions/extract-keywords":
            row, token = self.require_user()
            if not row: return
            payload = self.read_json_body()
            text = str(payload.get("text") or "")
            material_id = payload.get("material_id")
            if material_id and not text:
                ensure_db()
                with db_connect() as conn:
                    material_row = conn.execute("SELECT extracted_text FROM question_materials WHERE id = ? AND user_id = ?", (material_id, row["id"])).fetchone()
                    text = material_row[0] if material_row else ""
            limit = clamp_int(payload.get("limit") or payload.get("topN"), 1, 80, 20)
            try:
                keywords = extract_keywords_with_llm(
                    text,
                    str(payload.get("subject") or ""),
                    str(payload.get("school_level") or payload.get("schoolLevel") or ""),
                    str(payload.get("user_prompt") or payload.get("userPrompt") or ""),
                    limit,
                )
            except Exception as exc:
                print(f"LLM keyword extraction fallback: {exc}")
                keywords = extract_keywords(text, limit)
            return self.send_json(200, {"keywords": keywords, "keywordText": "\n".join(keywords)})
        if path == "/api/questions/search-sources":
            payload = self.read_json_body()
            keywords = payload.get("keywords") or []
            if isinstance(keywords, str):
                keywords = [x.strip() for x in keywords.split(",") if x.strip()]
            sources = [{
                "title": f"'{kw}' 기반 외부자료 검색 슬롯",
                "keyword": kw,
                "status": "temporary",
                "note": "임시 통합 버전에서는 PDF 문맥과 LLM 생성 프롬프트를 우선 사용합니다."
            } for kw in keywords[:10]]
            return self.send_json(200, {"sources": sources})
        if path == "/api/questions/generate":
            row, token = self.require_user()
            if not row: return
            try:
                return self.send_json(200, create_question_set(self.read_json_body(), row["id"]))
            except Exception as exc:
                print(f"Question generation failed: {exc}")
                return self.send_json(502, {
                    "error": str(exc),
                    "detail": "LLM 문제 생성에 실패해 fallback 문제를 저장하지 않았습니다. API 키, 네트워크, 모델 응답을 확인해 주세요.",
                })

        return self.send_json(404, {"error": "Not found"})

    def parse_multipart_form(self):
        content_type = self.headers.get("Content-Type", "")
        match = re.search(r"boundary=(?:\"([^\"]+)\"|([^;]+))", content_type)
        if not match:
            return {}, {}
        boundary = (match.group(1) or match.group(2)).strip().encode("utf-8")
        if not boundary or len(boundary) > 200:
            raise RequestError(400, "multipart boundary가 올바르지 않습니다.")
        length = self.content_length(MAX_UPLOAD_BYTES)
        body = self.rfile.read(length) if length else b""
        fields, files = {}, {}

        for part in body.split(b"--" + boundary):
            part = part.strip(b"\r\n")
            if not part or part == b"--":
                continue
            if b"\r\n\r\n" not in part:
                continue
            header_blob, data = part.split(b"\r\n\r\n", 1)
            data = data.rstrip(b"\r\n")
            headers = header_blob.decode("utf-8", errors="ignore")
            name_match = re.search(r'name="([^"]+)"', headers)
            if not name_match:
                continue
            name = name_match.group(1)
            filename_match = re.search(r'filename="([^"]*)"', headers)
            type_match = re.search(r"Content-Type:\s*([^\r\n]+)", headers, re.I)
            if filename_match and filename_match.group(1):
                item = {
                    "filename": filename_match.group(1),
                    "content_type": type_match.group(1).strip() if type_match else "application/octet-stream",
                    "data": data,
                }
                if name in files:
                    if isinstance(files[name], list):
                        files[name].append(item)
                    else:
                        files[name] = [files[name], item]
                else:
                    files[name] = item
            else:
                fields[name] = data.decode("utf-8", errors="ignore")
        return fields, files

    def handle_question_upload(self, user_id):
        ensure_db()
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            return self.send_json(400, {"error": "multipart/form-data 형식으로 업로드해 주세요."})

        fields, files = self.parse_multipart_form()
        raw_files = files.get("pdfs") or files.get("file")
        if not raw_files:
            return self.send_json(400, {"error": "PDF 파일이 필요합니다."})
        file_items = raw_files if isinstance(raw_files, list) else [raw_files]
        if len(file_items) > MAX_UPLOAD_FILE_COUNT:
            return self.send_json(413, {"error": f"한 번에 업로드할 수 있는 파일은 최대 {MAX_UPLOAD_FILE_COUNT}개입니다."})
        if sum(len(item.get("data") or b"") for item in file_items) > MAX_UPLOAD_BYTES:
            return self.send_json(413, {"error": "업로드 파일 크기가 너무 큽니다."})
        subject_id = fields.get("subject_id") or ""
        subject = fields.get("subject") or ""
        school_level = fields.get("schoolLevel") or fields.get("school_level") or ""
        user_prompt = fields.get("userPrompt") or fields.get("user_prompt") or ""
        top_n = clamp_int(fields.get("topN") or fields.get("top_n"), 1, 80, 20)
        start_page = normalize_positive_int(fields.get("startPage") or fields.get("start_page"), 1)
        end_page_raw = fields.get("endPage") or fields.get("end_page") or ""
        end_page = normalize_positive_int(end_page_raw, 0) if str(end_page_raw).strip() else None

        original_names = []
        stored_names = []
        total_bytes = 0
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        for file_item in file_items:
            raw = file_item["data"]
            original = safe_filename(file_item["filename"])
            digest = hashlib.sha1(raw).hexdigest()[:10]
            stored = f"{stamp}_{digest}_{original}"
            (UPLOAD_DIR / stored).write_bytes(raw)
            original_names.append(original)
            stored_names.append(stored)
            total_bytes += len(raw)

        extracted = extract_text_from_uploads(file_items, start_page, end_page)
        text = extracted["text"]
        if len(clean_compact(text, 200)) < 20:
            text = "\n".join(Path(name).stem.replace("_", " ") for name in original_names)
            extracted["warnings"].append("추출 텍스트가 너무 짧아 파일명 기반 키워드를 보조로 사용했습니다.")
        try:
            keywords = extract_keywords_with_llm(text, subject, school_level, user_prompt, top_n)
        except Exception as exc:
            print(f"LLM keyword extraction fallback: {exc}")
            keywords = extract_keywords(text, top_n)
        now = datetime.now().isoformat(timespec="seconds")
        with db_connect() as conn:
            cur = conn.execute(
                "INSERT INTO question_materials(user_id, subject_id, original_filename, stored_filename, mime_type, size_bytes, extracted_text, keywords_json, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (user_id, subject_id, ", ".join(original_names), ", ".join(stored_names), "application/pdf", total_bytes, text, json.dumps(keywords, ensure_ascii=False), now),
            )
            conn.commit()
            material_id = cur.lastrowid
        return self.send_json(200, {
            "ok": True,
            "material_id": material_id,
            "filename": ", ".join(original_names),
            "fileNames": original_names,
            "stored_filename": ", ".join(stored_names),
            "size_bytes": total_bytes,
            "keywords": keywords,
            "keywordText": "\n".join(keywords),
            "textLength": len(text),
            "selectedPageRange": extracted.get("selected_page_range"),
            "pageCount": extracted.get("page_count"),
            "filePageRanges": extracted.get("file_infos"),
            "warnings": extracted.get("warnings"),
            "created_at": now
        })

    def serve_static(self, request_path):
        if request_path in ("", "/"):
            request_path = "/index.html"

        rel = unquote(request_path.lstrip("/"))
        target = (BASE_DIR / rel).resolve()

        # 경로 탈출 방지
        if BASE_DIR not in target.parents and target != BASE_DIR:
            return self.send_error(403, "Forbidden")
        if not target.exists() or not target.is_file():
            # SPA처럼 동작하도록 없는 경로는 index.html로 반환
            target = BASE_DIR / "index.html"
        try:
            rel_path = target.relative_to(BASE_DIR)
        except ValueError:
            return self.send_error(403, "Forbidden")
        is_public_root_file = len(rel_path.parts) == 1 and target.name in PUBLIC_ROOT_FILES
        is_public_asset = len(rel_path.parts) >= 2 and rel_path.parts[0] == "assets"
        if (
            any(part.startswith(".") for part in rel_path.parts)
            or any(part in {"data", "__pycache__", "backups"} for part in rel_path.parts)
            or target.name in PRIVATE_STATIC_NAMES
            or target.suffix.lower() not in PUBLIC_STATIC_EXTS
            or not (is_public_root_file or is_public_asset)
        ):
            return self.send_error(404, "Not Found")

        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if target.suffix == ".js":
            content_type = "application/javascript; charset=utf-8"
        elif target.suffix in (".html", ".css"):
            content_type = f"text/{'html' if target.suffix == '.html' else 'css'}; charset=utf-8"

        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_security_headers()
        if target.name == "index.html":
            self.send_header("Cache-Control", "no-store")
        else:
            self.send_header("Cache-Control", "public, max-age=300")
        self.end_headers()
        self.wfile.write(data)


def main():
    ensure_db()
    os.chdir(BASE_DIR)
    server = ThreadingHTTPServer((HOST, PORT), SmartStudyHandler)
    print("SmartStudy AI 서버 실행 중")
    local_url = f"http://127.0.0.1:{PORT}" if HOST in ("0.0.0.0", "::") else f"http://{HOST}:{PORT}"
    print(f"접속 주소: {local_url}")
    print("종료: Ctrl + C")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n서버를 종료합니다.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
