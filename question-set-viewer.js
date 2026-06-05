const AUTH_TOKEN_KEY = "smartstudy_auth_token";
const SERVER_API_BASE = "";

function $(id) { return document.getElementById(id); }

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderKeywords(keywords) {
  if (!keywords || !keywords.length) return '<span class="empty-text">키워드 없음</span>';
  return `<div class="keyword-chip-row">${keywords.map(k => `<span class="keyword-chip">${escapeHtml(k)}</span>`).join("")}</div>`;
}

function renderQuestionMath(root) {
  if (!root || !window.MathJax || typeof window.MathJax.typesetPromise !== "function") return;
  if (typeof window.MathJax.typesetClear === "function") window.MathJax.typesetClear([root]);
  window.MathJax.typesetPromise([root]).catch(error => console.warn("MathJax render failed", error));
}

function renderQuestionSet(set) {
  const output = $("questionSetViewerOutput");
  if (!output) return;
  const allQuestions = Array.isArray(set.questions) ? set.questions : [];
  const questions = allQuestions.filter(q => String(q.confidence || "").toLowerCase() !== "low");
  const keywordList = questions.map(q => q.keyword).filter(Boolean);
  if (!questions.length) {
    output.innerHTML = `
      <article class="question-set-card">
        <h4>${escapeHtml(set.title || "키워드별 대표문제")}</h4>
        <div class="question-meta">표시할 수 있는 신뢰도의 대표문제가 없습니다.</div>
      </article>
    `;
    return;
  }
  output.innerHTML = `
    <article class="question-set-card">
      <h4>${escapeHtml(set.title || "키워드별 대표문제")}</h4>
      <div class="question-meta">생성일: ${escapeHtml(set.created_at || "")} · 최근 조회: ${escapeHtml(set.last_viewed_at || "")} · 문제 ${questions.length}개</div>
      <h5 class="question-section-title">키워드 목록</h5>
      ${renderKeywords(keywordList)}
    </article>
    <section class="question-output-section problem-section">
      <h4>문제</h4>
      ${questions.map((q, index) => `
        <article class="generated-question-card">
          <h4>${index + 1}. ${escapeHtml(q.question)}</h4>
          <div class="question-meta">핵심 키워드: ${escapeHtml(q.keyword)} · ${escapeHtml(q.type || "대표문제")} · 난이도 ${escapeHtml(q.difficulty || "")}</div>
          ${Array.isArray(q.choices) && q.choices.length ? `<ol>${q.choices.map(c => `<li>${escapeHtml(c)}</li>`).join("")}</ol>` : ""}
        </article>
      `).join("")}
    </section>
    <section class="question-output-section answer-section">
      <h4>정답</h4>
      ${questions.map((q, index) => `
        <article class="generated-question-card answer-card">
          <h4>${index + 1}. ${escapeHtml(q.keyword)}</h4>
          <div class="question-answer">${escapeHtml(q.answer || "")}</div>
        </article>
      `).join("")}
    </section>
    <section class="question-output-section explanation-section">
      <h4>해설</h4>
      ${questions.map((q, index) => `
        <article class="generated-question-card explanation-card">
          <h4>${index + 1}. ${escapeHtml(q.keyword)}</h4>
          <div class="question-answer">${escapeHtml(q.explanation || q.source_note || "")}</div>
        </article>
      `).join("")}
    </section>
  `;
  renderQuestionMath(output);
}

async function loadQuestionSet() {
  const output = $("questionSetViewerOutput");
  const id = new URLSearchParams(window.location.search).get("id");
  const token = localStorage.getItem(AUTH_TOKEN_KEY) || "";
  if (!id) {
    output.textContent = "열람할 예상문제 ID가 없습니다.";
    return;
  }
  if (!token) {
    output.textContent = "로그인 후 마이페이지에서 다시 열어 주세요.";
    return;
  }
  try {
    const res = await fetch(`${SERVER_API_BASE}/api/questions/sets/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || "저장된 예상문제를 불러오지 못했습니다.");
    renderQuestionSet(payload.set);
  } catch (error) {
    output.textContent = `저장된 예상문제 불러오기 실패: ${error.message}`;
  }
}

loadQuestionSet();
