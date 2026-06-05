const COLORS = ["#6bbfb5", "#8db497", "#90a9d7", "#e2b567", "#d98b84", "#b8deda", "#d4e6e1"];

const state = {
  categories: [
    { id: "cat_major", name: "전공", color: "#6bbfb5", blockedDates: new Set() },
    { id: "cat_general", name: "교양", color: "#8db497", blockedDates: new Set() },
  ],
  subjects: [],
  plans: {},
  globalBlockedDates: new Set(),
  // 날짜별 과목별 완료/미수행 체크 상태: { "YYYY-MM-DD": { subjectId: true/false } }
  completionLog: {},
  displayYear: null,
  displayMonth: null,
  weekStart: null,
  calendarMode: "week",
  selectedAdjustCategoryId: "cat_major",
  selectedAdjustSubjectId: null,
  adjustDisplayYear: null,
  adjustDisplayMonth: null,
  // 일정 조정탭에서 선택된 날짜
  adjustSelectedDate: null,
  editingSubjectId: null,
};

const views = {
  home: "homeView",
  calendar: "calendarView",
  adjust: "adjustView",
  subjects: "subjectsView",
  questions: "questionsView",
  report: "reportView",
  settings: "settingsView",
};

const stagePresets = {
  cram_2weeks: [
    ["1회독 압축 이해", 0.42, "핵심 개념 빠르게 훑기"],
    ["2회독 문제 적용", 0.36, "대표 문제와 자주 틀리는 유형 정리"],
    ["최종 점검", 0.22, "오답·암기·예상 문제 마무리"],
  ],
  steady_3to4weeks: [
    ["1회독 개념 정리", 0.35, "전체 범위를 처음부터 끝까지 안정적으로 정리"],
    ["2회독 문제 풀이", 0.35, "단원별 문제 풀이와 약점 체크"],
    ["3회독 오답 보완", 0.2, "틀린 문제 재풀이와 개념 연결"],
    ["최종 점검", 0.1, "시험 직전 암기·공식·빈출 유형 확인"],
  ],
  early_6weeks: [
    ["1회독 개념 구축", 0.28, "기초 개념과 용어를 넓게 정리"],
    ["2회독 기본 문제", 0.26, "기본문제 반복으로 풀이 감각 만들기"],
    ["3회독 심화 적용", 0.24, "응용·심화 유형까지 확장"],
    ["4회독 오답 압축", 0.14, "오답노트와 약점 단원 집중 보완"],
    ["최종 점검", 0.08, "실전 감각과 암기 요소 마무리"],
  ],
};

function $(id) { return document.getElementById(id); }
function pad(n) { return String(n).padStart(2, "0"); }

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function showView(name) {
  Object.values(views).forEach(id => $(id).classList.remove("active-view"));
  $(views[name] || views.home).classList.add("active-view");

  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });

  if (name === "calendar") {
    initializeMonth();
    renderCalendar();
  }

  if (name === "adjust") {
    renderAdjustView();
  }

  if (name === "subjects") {
    renderSubjectManagement();
  }

  if (name === "questions") {
    renderQuestionSubjectOptions();
  }

  if (name === "report") {
    renderReport();
  }

  if (name === "home") {
    renderHome();
  }
}

function getCategory(id) {
  return state.categories.find(c => c.id === id);
}

function getCategoryName(id) {
  return getCategory(id)?.name || "미분류";
}

function getCategoryColor(id) {
  return getCategory(id)?.color || "#64748b";
}

function initializeMonth() {
  const base = todayString();
  const d = parseDate(base);
  if (!state.displayYear || !state.displayMonth) {
    state.displayYear = d.getFullYear();
    state.displayMonth = d.getMonth() + 1;
    state.weekStart = formatDate(getStartOfWeek(d));
  }
}

function refreshCategorySelects() {
  const selects = [$("subjectCategory"), $("adjustCategory")].filter(Boolean);
  for (const select of selects) {
    const current = select.value || state.selectedAdjustCategoryId;
    select.innerHTML = "";
    for (const category of state.categories) {
      const option = document.createElement("option");
      option.value = category.id;
      option.textContent = category.name;
      select.appendChild(option);
    }
    if (state.categories.some(c => c.id === current)) select.value = current;
  }
}

function subjectInputPayload() {
  return {
    id: `sub_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    name: $("subjectName").value.trim(),
    categoryId: $("subjectCategory").value,
    examDate: $("examDate").value,
    unitCount: Number($("unitCount").value),
    dailyHours: Number($("dailyHours").value),
    studyType: $("studyType").value,
    difficulty: $("difficulty").value,
    mastery: $("mastery").value,
    startDate: $("startDate").value || todayString(),
    blockedDates: new Set(),
  };
}

function validateSubject(s) {
  if (!s.name) return "과목명을 입력해 주세요.";
  if (!s.categoryId) return "카테고리를 선택해 주세요.";
  if (!s.examDate) return "시험 날짜를 입력해 주세요.";
  if (!s.unitCount || s.unitCount < 1) return "범위량은 1 이상이어야 합니다.";
  if (!s.dailyHours || s.dailyHours <= 0) return "일일 공부 시간은 0보다 커야 합니다.";
  if (parseDate(s.startDate) >= parseDate(s.examDate)) return "시험 날짜는 시작일보다 뒤여야 합니다.";
  return null;
}

function setSubjectFormValues(subject) {
  if (!subject) return;
  $("subjectName").value = subject.name || "";
  $("subjectCategory").value = subject.categoryId || "cat_major";
  $("examDate").value = subject.examDate || "";
  $("unitCount").value = subject.unitCount ?? 12;
  $("dailyHours").value = subject.dailyHours ?? 2;
  $("studyType").value = subject.studyType || "steady_3to4weeks";
  $("difficulty").value = subject.difficulty || "medium";
  $("mastery").value = subject.mastery || "intermediate";
  $("startDate").value = subject.startDate || todayString();
}

function resetSubjectForm() {
  $("subjectName").value = "";
  $("subjectCategory").value = state.categories[0]?.id || "cat_major";
  $("examDate").value = "";
  $("unitCount").value = 12;
  $("dailyHours").value = 2;
  $("studyType").value = "steady_3to4weeks";
  $("difficulty").value = "medium";
  $("mastery").value = "intermediate";
  $("startDate").value = "";
}

function refreshSubjectActionUI() {
  const btn = $("addSubjectBtn");
  const helper = $("subjectActionHelper");
  if (btn) {
    btn.textContent = state.editingSubjectId ? "✅ 과목 수정 완료" : "➕ 과목 추가";
  }
  if (helper) {
    helper.textContent = state.editingSubjectId
      ? "수정 완료 버튼을 누르면 입력 값이 갱신되고 캘린더와 단계별 계획이 다시 생성됩니다."
      : "과목이 등록되면 아래 캘린더와 단계별 계획이 자동으로 업데이트됩니다.";
  }
}

function beginEditSubject(id) {
  const subject = state.subjects.find(s => s.id === id);
  if (!subject) return;
  state.editingSubjectId = id;
  setSubjectFormValues(subject);
  refreshSubjectActionUI();
  showView("calendar");
  const panel = $("subjectEntryPanel");
  if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  showToast(`${subject.name} 과목을 수정할 수 있도록 불러왔습니다.`);
}

function getDaysUntil(dateStr) {
  const today = parseDate(todayString());
  today.setHours(0, 0, 0, 0);
  const target = parseDate(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

function formatDday(dateStr) {
  const diff = getDaysUntil(dateStr);
  if (diff === 0) return "D-day";
  if (diff > 0) return `D-${diff}`;
  return `D+${Math.abs(diff)}`;
}

function addSubject() {
  const subject = subjectInputPayload();
  const error = validateSubject(subject);
  if (error) {
    showToast(error);
    return false;
  }

  let actionLabel = "추가";
  if (state.editingSubjectId) {
    const idx = state.subjects.findIndex(s => s.id === state.editingSubjectId);
    if (idx >= 0) {
      const prev = state.subjects[idx];
      subject.id = prev.id;
      subject.blockedDates = prev.blockedDates || new Set();
      state.subjects[idx] = subject;
      actionLabel = "수정";
    } else {
      state.subjects.push(subject);
    }
  } else {
    state.subjects.push(subject);
  }

  state.editingSubjectId = null;
  refreshSubjectActionUI();
  resetSubjectForm();
  renderSubjects();
  renderSubjectManagement();
  renderAdjustView();

  const generated = generateCalendar({ silent: true, emptyMessage: false });
  if (typeof saveStateToServer === "function") saveStateToServer();
  showToast(generated
    ? `${subject.name} 과목이 ${actionLabel}되고 캘린더가 생성되었습니다.`
    : `${subject.name} 과목이 ${actionLabel}되었습니다.`);
  return true;
}

function deleteSubject(id) {
  const subject = state.subjects.find(s => s.id === id);
  state.subjects = state.subjects.filter(s => s.id !== id);
  delete state.plans[id];

  // 삭제한 과목의 완료/미수행 로그도 함께 정리합니다.
  for (const dateStr of Object.keys(state.completionLog || {})) {
    if (state.completionLog[dateStr] && Object.prototype.hasOwnProperty.call(state.completionLog[dateStr], id)) {
      delete state.completionLog[dateStr][id];
    }
    if (state.completionLog[dateStr] && !Object.keys(state.completionLog[dateStr]).length) {
      delete state.completionLog[dateStr];
    }
  }

  if (state.selectedAdjustSubjectId === id) state.selectedAdjustSubjectId = null;
  if (state.editingSubjectId === id) { state.editingSubjectId = null; refreshSubjectActionUI(); resetSubjectForm(); }
  if ($("questionSubjectSelect")?.value === id) $("questionSubjectSelect").value = "";

  renderSubjects();
  renderSubjectManagement();
  renderAdjustView();
  renderCalendar();
  renderPlanList();
  renderQuestionSubjectOptions();
  if (typeof saveStateToServer === "function") saveStateToServer();
  showToast(`${subject?.name || "과목"}이 삭제되었습니다.`);
}

function clearSubjects() {
  state.subjects = [];
  state.plans = {};
  state.globalBlockedDates = new Set();
  state.editingSubjectId = null;
  refreshSubjectActionUI();
  resetSubjectForm();
  renderSubjects();
  renderSubjectManagement();
  renderAdjustView();
  renderCalendar();
  renderPlanList();
  showToast("등록된 과목이 모두 삭제되었습니다.");
}

function renderSubjects() {
  const list = $("subjectList");
  if (!list) return;

  if (!state.subjects.length) {
    list.innerHTML = '<p class="empty-text">아직 등록된 과목이 없습니다.</p>';
    return;
  }

  list.innerHTML = state.subjects.map(s => `
    <article class="subject-card">
      <div>
        <h4>${s.name}</h4>
        <div class="meta">
          시험일: ${s.examDate} · 범위: ${s.unitCount}단원 · ${s.dailyHours}시간/일<br/>
          카테고리: <span class="tag" style="background:${getCategoryColor(s.categoryId)}">${getCategoryName(s.categoryId)}</span>
        </div>
      </div>
      <div class="subject-actions">
        <button class="tiny-btn" onclick="deleteSubject('${s.id}')">삭제</button>
      </div>
    </article>
  `).join("");
}

function availableDatesForSubject(subject) {
  const subjectBlocked = getSubjectBlockedDates(subject);
  const dates = [];

  for (let d = parseDate(subject.startDate); d < parseDate(subject.examDate); d = addDays(d, 1)) {
    const dateStr = formatDate(d);
    if (!subjectBlocked.has(dateStr) && !state.globalBlockedDates.has(dateStr)) {
      dates.push(dateStr);
    }
  }

  return dates;
}

function difficultyMultiplier(difficulty) {
  if (difficulty === "high") return 1.15;
  if (difficulty === "low") return 0.9;
  return 1.0;
}

function masteryMultiplier(level) {
  if (level === "beginner") return 1.15;
  if (level === "advanced") return 0.9;
  return 1.0;
}

function designPlan(subject) {
  const available = availableDatesForSubject(subject);
  if (!available.length) {
    throw new Error(`${subject.name}의 공부 가능한 날짜가 없습니다.`);
  }

  const presets = stagePresets[subject.studyType] || stagePresets.steady_3to4weeks;
  const totalDays = available.length;
  const totalUnits = Math.max(1, subject.unitCount);
  const loadMultiplier = difficultyMultiplier(subject.difficulty) * masteryMultiplier(subject.mastery);
  const plan = [];
  let cursor = 0;

  presets.forEach(([name, ratio, focus], index) => {
    const remainingStages = presets.length - index;
    const remainingDays = totalDays - cursor;

    let stageDays;
    if (index === presets.length - 1) {
      stageDays = remainingDays;
    } else {
      stageDays = Math.max(1, Math.round(totalDays * ratio));
      stageDays = Math.min(stageDays, remainingDays - (remainingStages - 1));
    }

    const stageDates = available.slice(cursor, cursor + stageDays);
    cursor += stageDays;
    if (!stageDates.length) return;

    plan.push({
      subjectId: subject.id,
      subjectName: subject.name,
      categoryId: subject.categoryId,
      name,
      startDate: stageDates[0],
      endDate: stageDates[stageDates.length - 1],
      actualDates: stageDates,
      focus,
      recommendedUnitCount: Math.max(1, Math.round(totalUnits * ratio)),
      recommendedDailyHours: Math.max(0.5, Math.round(subject.dailyHours * loadMultiplier * 10) / 10),
      stageOrder: index + 1,
    });
  });

  return plan;
}

function generateCalendar(options = {}) {
  const { silent = false, emptyMessage = true } = options;

  if (!state.subjects.length) {
    if (emptyMessage) showToast("먼저 과목을 추가해 주세요.");
    return false;
  }

  try {
    state.plans = {};
    for (const subject of state.subjects) {
      state.plans[subject.id] = designPlan(subject);
    }

    renderCalendar();
    renderPlanList();

    const totalStages = Object.values(state.plans).flat().length;
    renderReport();
    if (typeof saveStateToServer === "function") saveStateToServer();
    if (!silent) showToast(`캘린더 생성 완료 · ${state.subjects.length}개 과목 · ${totalStages}개 단계`);
    return true;
  } catch (error) {
    showToast(`오류: ${error.message}`);
    return false;
  }
}

function planEventsOnDate(dateStr) {
  const events = [];

  for (const subject of state.subjects) {
    const plan = state.plans[subject.id] || [];
    for (const stage of plan) {
      const isActualStudyDate = Array.isArray(stage.actualDates)
        ? stage.actualDates.includes(dateStr)
        : (dateStr >= stage.startDate && dateStr <= stage.endDate);

      if (isActualStudyDate) {
        events.push({
          subject,
          stage,
          label: `${subject.name} - ${stage.name}`,
          color: getCategoryColor(subject.categoryId),
        });
      }
    }
  }

  return events;
}

function hexToRgba(hex, alpha = 1) {
  const normalized = String(hex || "").replace("#", "").trim();
  const safeHex = normalized.length === 3
    ? normalized.split("").map(ch => ch + ch).join("")
    : normalized.padEnd(6, "0").slice(0, 6);
  const int = Number.parseInt(safeHex, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function examEventsOnDate(dateStr) {
  return state.subjects.filter(subject => subject.examDate === dateStr);
}

function stageChipStyle(stageName) {
  const name = String(stageName || "");
  if (name.includes("1회독")) return { emoji: "📘", alpha: 0.13 };
  if (name.includes("2회독")) return { emoji: "🧩", alpha: 0.22 };
  if (name.includes("3회독")) return { emoji: "📝", alpha: 0.33 };
  if (name.includes("4회독")) return { emoji: "📚", alpha: 0.45 };
  if (name.includes("최종"))  return { emoji: "🎯", alpha: 0.60 };
  return { emoji: "📖", alpha: 0.18 };
}

function renderStudyEventChip(event) {
  const accent = event.color;
  const { emoji, alpha } = stageChipStyle(event.stage.name);
  const soft = hexToRgba(accent, alpha);
  const border = hexToRgba(accent, alpha + 0.18);
  return `
    <div class="event-chip soft-event-chip" style="--chip-accent:${accent}; --chip-soft:${soft}; --chip-border:${border};" title="${event.label}">
      <div class="event-chip-subject">${event.subject.name}</div>
      <div class="event-chip-stage">${emoji} ${event.stage.name}</div>
    </div>
  `;
}

function renderExamEventChip(subject) {
  const accent = getCategoryColor(subject.categoryId);
  const soft = hexToRgba(accent, 0.16);
  return `
    <div class="event-chip exam-event-chip" style="--exam-accent:${accent}; --exam-soft:${soft};" title="${subject.name} 시험일">
      <div class="event-chip-subject">${subject.name}</div>
      <div class="event-chip-stage">📝 시험 당일</div>
    </div>
  `;
}

function renderCalendar() {
  const grid = $("calendarGrid");
  if (!grid) return;
  grid.innerHTML = "";

  initializeMonth();
  grid.classList.toggle("week-mode", state.calendarMode === "week");

  if (state.calendarMode === "week") {
    renderWeekCalendar(grid);
  } else {
    renderMonthCalendar(grid);
  }

  renderLegend();
  updateCalendarToggle();
}

function renderMonthCalendar(grid) {
  $("calendarTitle").textContent = `${state.displayYear}년 ${pad(state.displayMonth)}월`;

  const firstDay = new Date(state.displayYear, state.displayMonth - 1, 1);
  const firstWeekday = firstDay.getDay();
  const lastDate = new Date(state.displayYear, state.displayMonth, 0).getDate();

  for (let i = 0; i < firstWeekday; i++) {
    const empty = document.createElement("div");
    empty.className = "day empty";
    grid.appendChild(empty);
  }

  for (let day = 1; day <= lastDate; day++) {
    const d = new Date(state.displayYear, state.displayMonth - 1, day);
    grid.appendChild(createCalendarCell(d, 4));
  }
}

function renderWeekCalendar(grid) {
  const start = state.weekStart ? parseDate(state.weekStart) : getStartOfWeek(new Date(state.displayYear, state.displayMonth - 1, 1));
  const end = addDays(start, 6);
  $("calendarTitle").innerHTML = `${formatDate(start)} ~ ${formatDate(end)} <span class="week-range">일주일 보기</span>`;

  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    grid.appendChild(createCalendarCell(d, 8));
  }
}

function createCalendarCell(d, maxEvents) {
  const dateStr = formatDate(d);
  const isBlocked = state.globalBlockedDates.has(dateStr);
  const allStudyEvents = planEventsOnDate(dateStr);
  const studyEvents = isBlocked ? [] : allStudyEvents.slice(0, maxEvents);
  const hiddenCount = isBlocked ? 0 : Math.max(0, allStudyEvents.length - studyEvents.length);
  const examEvents = examEventsOnDate(dateStr);

  const cell = document.createElement("div");
  cell.className = "day clickable-block-day";

  if (isBlocked) {
    cell.classList.add("global-blocked-day");
  }

  if (examEvents.length) {
    cell.classList.add("exam-day");
  }

  cell.addEventListener("click", () => toggleGlobalBlockedDate(dateStr));

  cell.innerHTML = `
    <div class="day-number-row">
      <div class="day-number">${d.getDate()}</div>
      ${examEvents.length ? '<div class="exam-day-pill">시험</div>' : ''}
    </div>
    ${isBlocked ? '<div class="global-blocked-badge">회색 처리 · 공부 불가</div>' : ''}
    <div class="event-stack">
      ${studyEvents.map(renderStudyEventChip).join("")}
      ${hiddenCount > 0 ? `<div class="event-more">+${hiddenCount}개 일정 더 보기</div>` : ""}
      ${examEvents.map(renderExamEventChip).join("")}
    </div>
  `;
  return cell;
}

function getStartOfWeek(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function updateCalendarToggle() {
  const monthBtn = $("monthViewBtn");
  const weekBtn = $("weekViewBtn");
  if (!monthBtn || !weekBtn) return;
  monthBtn.classList.toggle("active", state.calendarMode === "month");
  weekBtn.classList.toggle("active", state.calendarMode === "week");
}

function setCalendarMode(mode) {
  state.calendarMode = mode;
  if (mode === "week" && !state.weekStart) {
    state.weekStart = formatDate(getStartOfWeek(new Date(state.displayYear, state.displayMonth - 1, 1)));
  }
  renderCalendar();
}


function toggleGlobalBlockedDate(dateStr) {
  if (state.globalBlockedDates.has(dateStr)) {
    state.globalBlockedDates.delete(dateStr);
    showToast(`${dateStr} 공부 불가일 해제`);
  } else {
    state.globalBlockedDates.add(dateStr);
    showToast(`${dateStr} 공부 불가일 설정`);
  }

  recalculateAllPlansAfterGlobalBlock();
}

function recalculateAllPlansAfterGlobalBlock() {
  for (const subject of state.subjects) {
    try {
      state.plans[subject.id] = designPlan(subject);
    } catch (error) {
      console.warn(error);
    }
  }

  renderCalendar();
  renderPlanList();
  renderAdjustView();
  renderReport();
}

function renderLegend() {
  const legend = $("calendarLegend");
  if (!legend) return;

  legend.innerHTML = [
    ...state.categories.map(c => `
      <span><i class="dot" style="background:${hexToRgba(c.color, 0.75)}; border:1px solid ${hexToRgba(c.color, 0.5)};"></i>${c.name} 학습 일정</span>
    `),
    '<span><i class="dot dot-exam"></i>시험 당일</span>',
    '<span><i class="dot dot-blocked"></i>공부 불가일</span>'
  ].join("");
}


function planStageStyle(index, stageName) {
  const styles = [
    { icon: "📘", soft: "#e8f7f5", accent: "#6bbfb5", label: "1회독" },
    { icon: "🧩", soft: "#e8f4fb", accent: "#89c4e1", label: "2회독" },
    { icon: "📝", soft: "#fff4de", accent: "#7dbfaa", label: "3회독" },
    { icon: "📚", soft: "#e8f7f5", accent: "#3d9e94", label: "4회독" },
    { icon: "🎯", soft: "#ffeaea", accent: "#e8968e", label: "최종요약" },
  ];

  let idx = Math.min(index, styles.length - 1);
  const name = String(stageName || "");

  if (name.includes("1회독")) idx = 0;
  else if (name.includes("2회독")) idx = 1;
  else if (name.includes("3회독")) idx = 2;
  else if (name.includes("4회독")) idx = 3;
  else if (name.includes("최종")) idx = 4;

  return styles[idx];
}

function renderPlanList() {
  const list = $("planList");
  if (!list) return;

  const allPlans = Object.values(state.plans).flat();
  if (!allPlans.length) {
    list.innerHTML = '<p class="empty-text">캘린더를 생성하면 과목별 계획이 표시됩니다.</p>';
    return;
  }

  list.innerHTML = state.subjects.map(subject => {
    const stages = state.plans[subject.id] || [];
    if (!stages.length) return "";

    const dday = formatDday(subject.examDate);
    const color = getCategoryColor(subject.categoryId);
    const totalDays = stages.reduce((sum, st) =>
      sum + (Array.isArray(st.actualDates) ? st.actualDates.length : 0), 0);

    const stageRows = stages.map((stage, index) => {
      const style = planStageStyle(index, stage.name);
      const studyDays = Array.isArray(stage.actualDates) ? stage.actualDates.length : 0;
      const widthPct = totalDays > 0 ? Math.round((studyDays / totalDays) * 100) : 0;
      const isLast = index === stages.length - 1;
      return `
        <div class="pls-row ${isLast ? 'pls-row-last' : ''}">
          <div class="pls-icon" style="background:${style.soft}; color:${style.accent};">${style.icon}</div>
          <div class="pls-info">
            <div class="pls-name" style="color:${style.accent};">${stage.name}</div>
            <div class="pls-period">${stage.startDate} ~ ${stage.endDate}</div>
          </div>
          <div class="pls-right">
            <div class="pls-days">${studyDays}일</div>
            <div class="pls-bar-bg"><div class="pls-bar-fill" style="width:${widthPct}%; background:${style.accent};"></div></div>
          </div>
        </div>`;
    }).join("");

    return `
      <section class="plan-subject-block pls-block">
        <div class="pls-head">
          <div class="pls-head-left">
            <span class="pls-subject-name">${subject.name}</span>
            <span class="tag" style="background:${color}">${getCategoryName(subject.categoryId)}</span>
            <span class="plan-dday-badge">${dday}</span>
            <span class="pls-exam-date">시험일 ${subject.examDate} · 총 ${totalDays}일</span>
          </div>
          <div class="plan-subject-actions">
            <button class="mini-icon-btn edit-btn" type="button" onclick="beginEditSubject('${subject.id}')">✏️ 수정</button>
            <button class="mini-icon-btn delete-btn" type="button" onclick="deleteSubject('${subject.id}')">✕ 삭제</button>
          </div>
        </div>
        <div class="pls-list">${stageRows}</div>
      </section>
    `;
  }).join("");
}

function shiftMonth(delta) {
  if (state.calendarMode === "week") {
    const current = state.weekStart ? parseDate(state.weekStart) : getStartOfWeek(new Date(state.displayYear, state.displayMonth - 1, 1));
    const next = addDays(current, delta * 7);
    state.weekStart = formatDate(next);
    state.displayYear = next.getFullYear();
    state.displayMonth = next.getMonth() + 1;
    renderCalendar();
    return;
  }

  let y = state.displayYear;
  let m = state.displayMonth + delta;
  if (m < 1) { m = 12; y -= 1; }
  if (m > 12) { m = 1; y += 1; }
  state.displayYear = y;
  state.displayMonth = m;
  state.weekStart = formatDate(getStartOfWeek(new Date(y, m - 1, 1)));
  renderCalendar();
}

function fillSample() {
  state.subjects = [];
  state.plans = {};
  state.globalBlockedDates = new Set();
  const today = parseDate(todayString());

  state.subjects.push(
    {
      id: "sub_math_calc",
      name: "미적분학",
      categoryId: "cat_major",
      examDate: formatDate(addDays(today, 28)),
      unitCount: 12,
      dailyHours: 2,
      studyType: "steady_3to4weeks",
      difficulty: "medium",
      mastery: "intermediate",
      startDate: todayString(),
      blockedDates: new Set(),
    },
    {
      id: "sub_linear",
      name: "선형대수",
      categoryId: "cat_major",
      examDate: formatDate(addDays(today, 35)),
      unitCount: 10,
      dailyHours: 1.5,
      studyType: "early_6weeks",
      difficulty: "high",
      mastery: "intermediate",
      startDate: todayString(),
      blockedDates: new Set(),
    },
    {
      id: "sub_physics",
      name: "물리학",
      categoryId: "cat_general",
      examDate: formatDate(addDays(today, 24)),
      unitCount: 9,
      dailyHours: 2,
      studyType: "steady_3to4weeks",
      difficulty: "medium",
      mastery: "beginner",
      startDate: todayString(),
      blockedDates: new Set(),
    }
  );

  renderSubjects();
  renderSubjectManagement();
  generateCalendar();
}

function renderAdjustView() {
  initializeAdjustMonth();

  // 오늘 날짜 자동 선택 (처음 진입 시 또는 선택 없을 때)
  if (!state.adjustSelectedDate) {
    state.adjustSelectedDate = todayString();
    // 오늘이 속한 달로 이동
    const d = parseDate(todayString());
    state.adjustDisplayYear = d.getFullYear();
    state.adjustDisplayMonth = d.getMonth() + 1;
  }

  renderWeeklySummary();
  renderAdjustCalendar();
  renderAdjustDayDetail(state.adjustSelectedDate);
}

// 이번 주 요약 + 경고 배너
function calcWeeklyStats() {
  const today = parseDate(todayString());
  const dow = today.getDay();
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - dow);
  const weekEnd   = new Date(today); weekEnd.setDate(today.getDate() + (6 - dow));

  let totalPlanned = 0, totalDone = 0, totalMissed = 0;
  const missedDays = [];

  for (let d = new Date(weekStart); d <= weekEnd; d.setDate(d.getDate() + 1)) {
    const dateStr = formatDate(d);
    if (dateStr > todayString()) break; // 미래는 제외
    const events = planEventsOnDate(dateStr);
    if (!events.length) continue;
    totalPlanned += events.length;
    const log = state.completionLog[dateStr] || {};
    events.forEach(ev => {
      const s = log[ev.subject.id];
      if (s === true) totalDone++;
      if (s === false) { totalMissed++; }
    });
    if (events.some(ev => log[ev.subject.id] === false)) {
      missedDays.push(dateStr);
    }
  }

  return { totalPlanned, totalDone, totalMissed, missedDays,
    weekStartStr: formatDate(weekStart), weekEndStr: formatDate(weekEnd) };
}

function renderWeeklySummary() {
  const banner = $("weeklyWarningBanner");
  const bar    = $("weeklySummaryBar");

  if (!state.subjects.length || !Object.keys(state.plans).length) {
    if (bar) bar.innerHTML = "";
    if (banner) banner.style.display = "none";
    return;
  }

  const { totalPlanned, totalDone, totalMissed, missedDays, weekStartStr, weekEndStr } = calcWeeklyStats();

  // 경고 배너: 이번 주 미수행 3회 이상
  if (banner) {
    if (totalMissed >= 3) {
      banner.style.display = "block";
      banner.innerHTML = `
        <div class="weekly-warning-banner">
          ⚠️ 이번 주 미수행이 <strong>${totalMissed}회</strong> 발생했어요. 일정 조정이 필요할 수 있습니다.
        </div>`;
    } else {
      banner.style.display = "none";
    }
  }

  // weeklySummaryBar 없으면 여기서 종료
  if (!bar) return;

  // 주간 요약 바
  const donePct  = totalPlanned > 0 ? Math.round((totalDone / totalPlanned) * 100) : 0;
  const missedPct = totalPlanned > 0 ? Math.round((totalMissed / totalPlanned) * 100) : 0;
  const uncheckedPct = Math.max(0, 100 - donePct - missedPct);

  bar.innerHTML = `
    <div class="weekly-summary-inner">
      <div class="weekly-summary-label">
        <span class="weekly-range">${weekStartStr} ~ ${weekEndStr} 이번 주</span>
        <span class="weekly-stats">
          <span class="ws-done">✓ 완료 ${totalDone}</span>
          <span class="ws-miss">✕ 미수행 ${totalMissed}</span>
          <span class="ws-pend">⬜ 미체크 ${Math.max(0, totalPlanned - totalDone - totalMissed)}</span>
        </span>
      </div>
      <div class="weekly-bar-bg">
        <div class="weekly-bar-done"  style="width:${donePct}%"></div>
        <div class="weekly-bar-miss"  style="width:${missedPct}%; left:${donePct}%"></div>
        <div class="weekly-bar-pend"  style="width:${uncheckedPct}%; left:${donePct + missedPct}%"></div>
      </div>
      <div class="weekly-bar-legend">
        <span><i style="background:#6bbfb5"></i>완료 ${donePct}%</span>
        <span><i style="background:#e8968e"></i>미수행 ${missedPct}%</span>
        <span><i style="background:#e0e7e5"></i>미체크 ${uncheckedPct}%</span>
      </div>
    </div>`;
}

function missedSubjectIdsOnDate(dateStr) {
  const log = state.completionLog[dateStr] || {};
  return Object.keys(log).filter(subjectId => log[subjectId] === false);
}

function rescheduleSubjectAfterSkippedDate(dateStr, subjectId) {
  const subject = state.subjects.find(s => s.id === subjectId);
  if (!subject) return null;

  getSubjectBlockedDates(subject).add(dateStr);
  state.plans[subjectId] = designPlan(subject);
  return subject;
}

function renderAdjustCalendar() {
  const grid = $("adjustCalendarGrid");
  if (!grid) return;
  grid.innerHTML = "";

  $("adjustCalendarTitle").textContent = `${state.adjustDisplayYear}년 ${pad(state.adjustDisplayMonth)}월`;

  const firstDay = new Date(state.adjustDisplayYear, state.adjustDisplayMonth - 1, 1);
  const firstWeekday = firstDay.getDay();
  const lastDate = new Date(state.adjustDisplayYear, state.adjustDisplayMonth, 0).getDate();
  const today = todayString();

  for (let i = 0; i < firstWeekday; i++) {
    const empty = document.createElement("div");
    empty.className = "day empty";
    grid.appendChild(empty);
  }

  for (let day = 1; day <= lastDate; day++) {
    const d = new Date(state.adjustDisplayYear, state.adjustDisplayMonth - 1, day);
    const dateStr = formatDate(d);
    const cell = document.createElement("div");
    cell.className = "day adjust-day";

    const isGlobalBlocked = state.globalBlockedDates.has(dateStr);
    const isToday = dateStr === today;
    const isSelected = dateStr === state.adjustSelectedDate;
    const eventsOnDay = planEventsOnDate(dateStr);
    const hasPlans = eventsOnDay.length > 0;

    // 완료/미수행 여부 계산
    const missedSubjectIds = missedSubjectIdsOnDate(dateStr);
    let doneCount = 0;
    let missedCount = missedSubjectIds.length;
    if (hasPlans && state.completionLog[dateStr]) {
      for (const ev of eventsOnDay) {
        const status = state.completionLog[dateStr][ev.subject.id];
        if (status === true) doneCount++;
      }
    }

    if (isGlobalBlocked) cell.classList.add("globally-blocked");
    if (isToday) cell.classList.add("today");
    if (isSelected) cell.classList.add("selected-day");
    if ((hasPlans || missedCount > 0) && !isGlobalBlocked) cell.classList.add("has-plan");

    let indicator = "";
    if (isGlobalBlocked) {
      indicator = `<div class="day-dot blocked-dot"></div>`;
    } else if (missedCount > 0 && !hasPlans) {
      indicator = `<div class="day-summary missed">✕ ${missedCount}미수행</div>`;
    } else if (hasPlans) {
      const total = eventsOnDay.length + missedCount;
      const checked = doneCount + missedCount;
      if (checked === 0) {
        // 색상 점들로 과목 표시
        indicator = eventsOnDay.slice(0, 3).map(ev =>
          `<div class="day-dot" style="background:${ev.color}"></div>`
        ).join("");
      } else if (missedCount > 0) {
        indicator = `<div class="day-summary missed">✕ ${missedCount}미수행</div>`;
      } else {
        indicator = `<div class="day-summary done">✓ ${doneCount}/${total}</div>`;
      }
    }

    cell.innerHTML = `
      <div class="day-number">${day}${isToday ? '<span class="today-dot"></span>' : ''}</div>
      <div class="day-indicators">${indicator}</div>
    `;

    if (!isGlobalBlocked) {
      cell.addEventListener("click", () => {
        state.adjustSelectedDate = dateStr;
        renderAdjustCalendar();
        renderAdjustDayDetail(dateStr);
      });
    }

    grid.appendChild(cell);
  }
}

function renderAdjustDayDetail(dateStr) {
  const panel = $("adjustDayDetail");
  if (!panel) return;

  if (!dateStr) {
    panel.innerHTML = `
      <div class="detail-empty">
        <div class="detail-empty-icon">📅</div>
        <p>날짜를 선택하면<br/>당일 학습 목록이 표시됩니다.</p>
      </div>`;
    return;
  }

  const d = parseDate(dateStr);
  const isGlobalBlocked = state.globalBlockedDates.has(dateStr);
  const eventsOnDay = planEventsOnDate(dateStr);
  const missedSubjectIds = missedSubjectIdsOnDate(dateStr);
  const dayLabel = `${d.getMonth() + 1}월 ${d.getDate()}일 (${["일","월","화","수","목","금","토"][d.getDay()]})`;
  const isToday = dateStr === todayString();

  // 패널 제목 업데이트
  const panelTitle = $("adjustDayPanelTitle");
  if (panelTitle) panelTitle.textContent = isToday ? `📋 오늘 · ${dayLabel}` : `📋 ${dayLabel}`;

  if (isGlobalBlocked) {
    panel.innerHTML = `
      <div class="detail-header">
        <h3>${dayLabel}</h3>
        <span class="badge badge-blocked">공부 불가일</span>
      </div>
      <p class="detail-note">이 날은 공부 불가일로 설정되어 있습니다. 캘린더 생성 탭에서 해제할 수 있습니다.</p>`;
    return;
  }

  if (!eventsOnDay.length && !missedSubjectIds.length) {
    panel.innerHTML = `
      <div class="detail-header"><h3>${dayLabel}</h3></div>
      <div class="detail-empty"><p>이 날에 예정된 학습이 없습니다.</p></div>`;
    return;
  }

  const log = state.completionLog[dateStr] || {};

  const visibleEventSubjectIds = new Set(eventsOnDay.map(ev => ev.subject.id));

  const items = eventsOnDay.map(ev => {
    const status = log[ev.subject.id];
    const isDone = status === true;
    const isMissed = status === false;
    const isBlocked = getSubjectBlockedDates(ev.subject).has(dateStr);

    return `
      <div class="task-item ${isDone ? 'task-done' : ''} ${isMissed ? 'task-missed' : ''} ${isBlocked ? 'task-blocked' : ''}">
        <div class="task-color-bar" style="background:${ev.color}"></div>
        <div class="task-info">
          <div class="task-name">${ev.subject.name}${isBlocked ? ' <span class="task-blocked-badge">제외됨</span>' : ''}</div>
          <div class="task-stage">${ev.stage.name} · ${ev.stage.recommendedUnitCount}단원${isBlocked ? ' · 제외됨' : ''}</div>
        </div>
        <div class="task-actions">
          <button class="task-btn done-btn ${isDone ? 'active' : ''} ${isBlocked ? 'task-btn--disabled' : ''}"
            onclick="markTaskCompletion('${dateStr}','${ev.subject.id}',true)"
            title="완료" ${isBlocked ? 'disabled' : ''}>✓</button>
          <button class="task-btn miss-btn ${isMissed ? 'active' : ''} ${isBlocked ? 'task-btn--disabled' : ''}"
            onclick="markTaskCompletion('${dateStr}','${ev.subject.id}',false)"
            title="미수행" ${isBlocked ? 'disabled' : ''}>✕</button>
        </div>
      </div>`;
  }).join("");

  const missedItems = missedSubjectIds
    .filter(subjectId => !visibleEventSubjectIds.has(subjectId))
    .map(subjectId => {
      const subject = state.subjects.find(s => s.id === subjectId);
      if (!subject) return "";
      const color = getCategoryColor(subject.categoryId);
      return `
        <div class="task-item task-missed">
          <div class="task-color-bar" style="background:${color}"></div>
          <div class="task-info">
            <div class="task-name">${subject.name}</div>
            <div class="task-stage">미수행 처리됨 · 이후 일정 재계산 완료</div>
          </div>
          <div class="task-actions">
            <button class="task-btn miss-btn active"
              onclick="markTaskCompletion('${dateStr}','${subject.id}',false)"
              title="미수행 체크 해제">✕</button>
          </div>
        </div>`;
    }).join("");

  panel.innerHTML = `
    <div class="detail-header">
      <h3>${dayLabel}</h3>
      <span class="badge badge-plan">${eventsOnDay.length + missedSubjectIds.length}개 기록</span>
    </div>
    <div class="task-list">${items}${missedItems}</div>
    <p class="detail-note">✓ 완료 또는 ✕ 미수행을 체크하면 일정이 자동으로 재계산됩니다.</p>
  `;
}

function markTaskCompletion(dateStr, subjectId, completed) {
  if (!state.completionLog[dateStr]) state.completionLog[dateStr] = {};

  const current = state.completionLog[dateStr][subjectId];

  // 같은 버튼 다시 누르면 토글(해제)
  if (current === completed) {
    delete state.completionLog[dateStr][subjectId];

    if (!completed) {
      const subject = state.subjects.find(s => s.id === subjectId);
      if (subject) {
        getSubjectBlockedDates(subject).delete(dateStr);
        try {
          state.plans[subjectId] = designPlan(subject);
        } catch (e) {
          showToast(`미수행 해제 후 재계산 실패: ${e.message}`);
        }
      }
    }

    showToast("체크 해제됨");
  } else {
    state.completionLog[dateStr][subjectId] = completed;

    if (!completed) {
      try {
        const subject = rescheduleSubjectAfterSkippedDate(dateStr, subjectId);
        showToast(subject ? `${subject.name} 미수행 반영 · 일정이 재계산되었습니다.` : "미수행으로 체크되었습니다.");
      } catch (e) {
        showToast(`미수행 반영 후 재계산 실패: ${e.message}`);
      }
    } else {
      const subject = state.subjects.find(s => s.id === subjectId);
      if (subject) {
        getSubjectBlockedDates(subject).delete(dateStr);
        try {
          state.plans[subjectId] = designPlan(subject);
        } catch (e) {}
      }
      showToast("완료로 기록되었습니다.");
    }
  }

  renderCalendar();
  renderPlanList();
  renderAdjustCalendar();
  renderAdjustDayDetail(dateStr);
  renderReport();
}

function toggleBlockScheduleOnDate(dateStr, subjectId) {
  const subject = state.subjects.find(s => s.id === subjectId);
  if (!subject) return;
  const blocked = getSubjectBlockedDates(subject);
  const isCurrentlyBlocked = blocked.has(dateStr);

  if (isCurrentlyBlocked) {
    blocked.delete(dateStr);
    try {
      state.plans[subjectId] = designPlan(subject);
      showToast(`${subject.name}의 ${dateStr} 일정이 복구되었습니다. ↩`);
    } catch (e) {
      showToast(`복구 후 재조정 실패: ${e.message}`);
    }
  } else {
    blocked.add(dateStr);
    try {
      state.plans[subjectId] = designPlan(subject);
      showToast(`${subject.name}의 ${dateStr}을 제외했습니다. 일정 재계산 완료.`);
    } catch (e) {
      showToast(`제외 후 재조정 실패: ${e.message}`);
    }
  }

  renderCalendar();
  renderPlanList();
  renderAdjustCalendar();
  renderAdjustDayDetail(dateStr);
  if (typeof saveStateToServer === "function") saveStateToServer();
}
window.toggleBlockScheduleOnDate = toggleBlockScheduleOnDate;

function deleteScheduleOnDate(dateStr, subjectId) {
  const subject = state.subjects.find(s => s.id === subjectId);
  if (!subject) return;

  getSubjectBlockedDates(subject).add(dateStr);
  if (state.completionLog[dateStr]) {
    delete state.completionLog[dateStr][subjectId];
  }

  try {
    state.plans[subjectId] = designPlan(subject);
    showToast(`${subject.name}의 ${dateStr} 일정이 삭제되었습니다.`);
  } catch (e) {
    showToast(`일정 삭제 후 재조정 실패: ${e.message}`);
  }

  renderCalendar();
  renderPlanList();
  renderAdjustCalendar();
  renderAdjustDayDetail(dateStr);
}

window.deleteScheduleOnDate = deleteScheduleOnDate;

window.markTaskCompletion = markTaskCompletion;

function getSelectedAdjustSubject() {
  const id = $("adjustSubject")?.value || state.selectedAdjustSubjectId;
  return state.subjects.find(s => s.id === id) || null;
}

function getSubjectBlockedDates(subject) {
  if (!subject.blockedDates) subject.blockedDates = new Set();
  return subject.blockedDates;
}

function initializeAdjustMonth() {
  if (state.adjustDisplayYear && state.adjustDisplayMonth) return;
  const d = parseDate(todayString());
  state.adjustDisplayYear = d.getFullYear();
  state.adjustDisplayMonth = d.getMonth() + 1;
}

function shiftAdjustMonth(delta) {
  let y = state.adjustDisplayYear;
  let m = state.adjustDisplayMonth + delta;
  if (m < 1) { m = 12; y -= 1; }
  if (m > 12) { m = 1; y += 1; }
  state.adjustDisplayYear = y;
  state.adjustDisplayMonth = m;
  renderAdjustCalendar();
}

function applySubjectAdjust(showDoneToast = true) {
  // 구버전 호환 유지용 - 현재 미사용
}

function clearSelectedSubjectBlockedDates() {
  // 현재 미사용 (X 체크가 자동 처리)
}

function addBlockedDate() {
  showToast("캘린더 날짜를 직접 클릭해 공부 불가일을 설정하세요.");
}

function removeBlockedDate() {}
function applyAdjust() {}
function renderBlockedList() {}
function renderAdjustSubjectList() {}
function refreshAdjustSubjectSelect() {}

function addCategory() {
  showToast("카테고리는 전공 / 교양으로 고정되어 있습니다.");
}

function calcSubjectProgress(subject) {
  const plan = state.plans[subject.id] || [];

  // 과목 관리 달성률은 날짜 경과가 아니라 "학습 토큰" 기준입니다.
  // 토큰 1개 = 계획표에 배치된 해당 과목의 날짜별 학습 1개.
  const plannedTokens = [];
  for (const stage of plan) {
    const dates = Array.isArray(stage.actualDates) ? stage.actualDates : [];
    for (const date of dates) {
      plannedTokens.push({ date, stageName: stage.name });
    }
  }

  const totalTokens = plannedTokens.length;
  if (totalTokens === 0) {
    return {
      totalTokens: 0,
      completedTokens: 0,
      missedTokens: countSubjectLogs(subject.id, false),
      uncheckedTokens: 0,
      rate: 0,
      stageStats: []
    };
  }

  let completedTokens = 0;
  let missedTokensInCurrentPlan = 0;

  for (const token of plannedTokens) {
    const status = state.completionLog[token.date]?.[subject.id];
    if (status === true) completedTokens++;
    if (status === false) missedTokensInCurrentPlan++;
  }

  // 미수행 체크 후 재계산되면 해당 날짜가 현재 계획에서 빠질 수 있으므로,
  // 별도 로그까지 포함해 참고 수치로 보여줍니다. 단, 달성률 분자에는 절대 포함하지 않습니다.
  const missedTokens = Math.max(missedTokensInCurrentPlan, countSubjectLogs(subject.id, false));
  const uncheckedTokens = Math.max(0, totalTokens - completedTokens - missedTokensInCurrentPlan);

  // 달성률 = 완료 체크된 토큰 / 전체 계획 토큰
  // 처음에는 완료 체크가 없으므로 항상 0%에서 시작합니다.
  const rate = Math.min(100, Math.round((completedTokens / totalTokens) * 100));

  const stageStats = plan.map(stage => {
    const dates = Array.isArray(stage.actualDates) ? stage.actualDates : [];
    const completed = dates.filter(d => state.completionLog[d]?.[subject.id] === true).length;
    return { name: stage.name, totalTokens: dates.length, completedTokens: completed };
  }).filter(s => s.totalTokens > 0);

  return { totalTokens, completedTokens, missedTokens, uncheckedTokens, rate, stageStats };
}

function countSubjectLogs(subjectId, expectedStatus) {
  let count = 0;
  for (const dateStr of Object.keys(state.completionLog || {})) {
    if (state.completionLog[dateStr]?.[subjectId] === expectedStatus) count++;
  }
  return count;
}

function renderSubjectDeleteList() {
  const deleteList = $("manageDeleteSubjectList");
  // 과목 관리 탭에서 별도 삭제 패널을 제거했으므로, 요소가 없으면 조용히 종료한다.
  if (!deleteList) return;

  if (!state.subjects.length) {
    deleteList.innerHTML = '<p class="empty-text">삭제할 과목이 없습니다.</p>';
    return;
  }

  deleteList.innerHTML = state.subjects.map(s => {
    const color = getCategoryColor(s.categoryId);
    const catName = getCategoryName(s.categoryId);
    const tokenCount = (state.plans[s.id] || []).reduce((sum, stage) => {
      const dates = Array.isArray(stage.actualDates) ? stage.actualDates.length : 0;
      return sum + dates;
    }, 0);

    return `
      <article class="subject-delete-card">
        <div class="subject-delete-left">
          <span class="delete-color-dot" style="background:${color}"></span>
          <div>
            <strong>${escapeHtml(s.name)}</strong>
            <p>${escapeHtml(catName)} · 시험일 ${escapeHtml(s.examDate || "미지정")} · 계획 토큰 ${tokenCount}개</p>
          </div>
        </div>
        <button class="subject-remove-btn" type="button" onclick="confirmDeleteSubject('${s.id}')">제거</button>
      </article>`;
  }).join("");
}

function confirmDeleteSubject(id) {
  const subject = state.subjects.find(s => s.id === id);
  const name = subject?.name || "이 과목";
  if (!confirm(`${name}을(를) 제거할까요?
해당 과목의 계획과 체크 기록도 함께 삭제됩니다.`)) return;
  deleteSubject(id);
}

function renderSubjectManagement() {
  refreshCategorySelects();

  const subjectList = $("manageSubjectList");
  if (!subjectList) return;

  if (!state.subjects.length) {
    subjectList.innerHTML = '<p class="empty-text">등록된 과목이 없습니다.<br/>캘린더 생성 탭에서 과목을 추가해 주세요.</p>';
    return;
  }

  const hasPlan = Object.keys(state.plans).length > 0;

  subjectList.innerHTML = state.subjects.map(s => {
    const color = getCategoryColor(s.categoryId);
    const prog = hasPlan ? calcSubjectProgress(s) : null;
    const dday = formatDday(s.examDate);

    const statusBadge = prog
      ? prog.rate >= 80
        ? `<span class="status-badge badge-great">우수 🎉</span>`
        : prog.rate >= 50
        ? `<span class="status-badge badge-good">양호 👍</span>`
        : prog.rate > 0
        ? `<span class="status-badge badge-warn">분발 💪</span>`
        : `<span class="status-badge badge-none">미시작</span>`
      : "";

    const progressBody = prog && prog.totalTokens > 0
      ? (() => {
          const progressPct = prog.rate;
          const missedPct = Math.min(100, Math.round((prog.missedTokens / prog.totalTokens) * 100));
          const uncheckedPct = Math.max(0, 100 - progressPct - missedPct);
          return `
          <div class="progress-visual-layout">
            <div class="progress-visual-left">
              <div class="progress-ring" style="--ring-color:${color}; --progress:${progressPct};">
                <div class="progress-ring-inner">
                  <strong>${progressPct}%</strong>
                  <span>달성</span>
                </div>
              </div>
              <div class="progress-summary-text">
                <strong>${prog.completedTokens} / ${prog.totalTokens}</strong>
                <span>완료된 학습 토큰</span>
                <small>미수행 ${prog.missedTokens}개 · 미체크 ${prog.uncheckedTokens}개</small>
              </div>
            </div>
            <div class="progress-visual-right">
              <div class="progress-bar-bg progress-bar-multi">
                <div class="progress-bar-fill" style="width:${progressPct}%;background:${color};"></div>
                <div class="progress-bar-missed" style="left:${progressPct}%; width:${missedPct}%; background:#d9b0aa;"></div>
                <div class="progress-bar-pend" style="left:${progressPct + missedPct}%; width:${uncheckedPct}%;"></div>
              </div>
              <div class="progress-legend">
                <span><i style="background:${color};"></i>완료</span>
                <span><i style="background:#d9b0aa;"></i>미수행</span>
                <span><i style="background:#e5e7eb;"></i>미체크</span>
              </div>
              ${prog.stageStats.length ? `
              <div class="stage-progress-list">
                ${prog.stageStats.map((st, index) => {
                  const stagePct = st.totalTokens ? Math.round((st.completedTokens / st.totalTokens) * 100) : 0;
                  const stageStyle = planStageStyle(index, st.name);
                  return `<div class="stage-progress-item">
                    <span class="stage-progress-name">${stageStyle.icon} ${st.name}</span>
                    <div class="stage-bar-bg">
                      <div class="stage-bar-fill" style="width:${stagePct}%; background:${stageStyle.accent};"></div>
                    </div>
                    <span class="stage-progress-pct">${stagePct}%</span>
                  </div>`;
                }).join("")}
              </div>` : ""}
            </div>
          </div>`;
        })()
      : `<p class="progress-hint">캘린더를 먼저 생성하면 달성률이 시각화됩니다.</p>`;

    return `
      <article class="subject-progress-card rich-progress-card" style="border-left:5px solid ${color}; --subject-accent:${color};">
        <div class="subject-progress-header">
          <div class="subject-progress-info subject-progress-info-clean">
            <strong class="subject-progress-name">${s.name}</strong>
            <span class="subject-dday-badge">${dday}</span>
            ${statusBadge}
          </div>
          <div class="subject-progress-meta-block">
            <div class="subject-progress-meta">시험일 ${s.examDate} · ${s.unitCount}단원 · ${s.dailyHours}시간/일</div>
            <div class="subject-progress-actions">
              <button class="mini-icon-btn edit-btn" type="button" onclick="beginEditSubject('${s.id}')">✏️ 수정</button>
              ${isExamPassed(s) ? `<button class="mini-icon-btn report-btn" type="button" onclick="toggleImprovementReport('${s.id}')">📋 리포트</button>` : ""}
              <button class="mini-icon-btn delete-btn" type="button" onclick="confirmDeleteSubject('${s.id}')">✕ 삭제</button>
            </div>
          </div>
        </div>
        ${progressBody}
        <div id="report-${s.id}" class="improvement-report-wrapper" style="display:none;"></div>
      </article>`;
  }).join("");

  renderSubjects();
}

function toggleImprovementReport(subjectId) {
  const wrapper = $(`report-${subjectId}`);
  if (!wrapper) return;
  const subject = state.subjects.find(s => s.id === subjectId);
  if (!subject) return;

  if (wrapper.style.display === "none") {
    wrapper.innerHTML = renderImprovementReport(subject);
    wrapper.style.display = "block";
    wrapper.scrollIntoView({ behavior: "smooth", block: "nearest" });
    // 버튼 텍스트 변경
    const btn = document.querySelector(`[onclick="toggleImprovementReport('${subjectId}')"]`);
    if (btn) btn.textContent = "📋 리포트 닫기";
  } else {
    wrapper.style.display = "none";
    wrapper.innerHTML = "";
    const btn = document.querySelector(`[onclick="toggleImprovementReport('${subjectId}')"]`);
    if (btn) btn.textContent = "📋 리포트";
  }
}
window.toggleImprovementReport = toggleImprovementReport;

window.confirmDeleteSubject = confirmDeleteSubject;
window.beginEditSubject = beginEditSubject;
window.deleteSubject = deleteSubject;


// ===== 예상 문제 생성 탭: API 연결 =====
let lastQuestionSources = [];
let lastQuestionMaterial = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderQuestionSubjectOptions() {
  const select = $("questionSubjectSelect");
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">과목 미선택</option>' + state.subjects.map(s =>
    `<option value="${s.id}">${escapeHtml(s.name)} · ${escapeHtml(getCategoryName(s.categoryId))}</option>`
  ).join("");
  if (state.subjects.some(s => s.id === current)) select.value = current;
}

function selectedQuestionSubjectName() {
  const manual = ($("questionSubjectText")?.value || "").trim();
  if (manual) return manual;
  const subjectId = $("questionSubjectSelect")?.value || "";
  const subject = state.subjects.find(s => s.id === subjectId);
  return subject?.name || "";
}

function keywordInputList() {
  const input = $("questionKeywordInput");
  if (!input) return [];
  return input.value
    .split(/[\n,]/)
    .map(v => v.trim())
    .filter(Boolean);
}

function renderQuestionMath(root = $("questionOutput")) {
  if (!root || !window.MathJax || typeof window.MathJax.typesetPromise !== "function") return;
  if (typeof window.MathJax.typesetClear === "function") window.MathJax.typesetClear([root]);
  window.MathJax.typesetPromise([root]).catch(error => console.warn("MathJax render failed", error));
}

function renderKeywords(keywords) {
  if (!keywords || !keywords.length) return '<span class="empty-text">키워드 없음</span>';
  return `<div class="keyword-chip-row">${keywords.map(k => `<span class="keyword-chip">${escapeHtml(k)}</span>`).join("")}</div>`;
}

function requireQuestionLogin() {
  if (authState.token) return true;
  showToast("로그인 후 예상문제 생성 기록을 저장할 수 있습니다.");
  openAuthModal();
  return false;
}

async function uploadQuestionMaterial(options = {}) {
  if (!requireQuestionLogin()) return null;
  const fileInput = $("questionFileInput");
  const resultBox = $("materialResult");
  const files = Array.from(fileInput?.files || []);
  if (!files.length) {
    showToast("분석할 PDF 파일을 선택해 주세요.");
    return null;
  }

  const form = new FormData();
  files.forEach(file => form.append("pdfs", file));
  form.append("subject_id", $("questionSubjectSelect")?.value || "");
  form.append("subject", selectedQuestionSubjectName());
  form.append("schoolLevel", $("questionSchoolLevelSelect")?.value || "");
  form.append("userPrompt", $("questionUserPromptInput")?.value || "");
  form.append("topN", $("questionTopNInput")?.value || "20");
  form.append("startPage", $("questionStartPageInput")?.value || "1");
  const endPage = ($("questionEndPageInput")?.value || "").trim();
  if (endPage) form.append("endPage", endPage);

  try {
    resultBox.textContent = "PDF에서 키워드를 추출하는 중...";
    const res = await fetch(`${SERVER_API_BASE}/api/questions/upload`, { method: "POST", headers: authHeaders(), body: form });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || "업로드 실패");
    lastQuestionMaterial = payload;
    const keywords = payload.keywords || [];
    if ($("questionKeywordInput") && keywords.length) {
      $("questionKeywordInput").value = keywords.join("\n");
    }
    const warnings = Array.isArray(payload.warnings) && payload.warnings.length
      ? `\n주의: ${payload.warnings.map(escapeHtml).join(" / ")}`
      : "";
    resultBox.innerHTML =
      `분석 완료: ${escapeHtml(payload.filename)}\n` +
      `페이지 범위: ${escapeHtml(payload.selectedPageRange || "")}\n` +
      `추출 텍스트: ${escapeHtml(payload.textLength || 0)}자\n` +
      `키워드 ${keywords.length}개:${renderKeywords(keywords)}${warnings}`;
    if (!options.silent) showToast("키워드 추출 완료");
    return payload;
  } catch (error) {
    resultBox.textContent = `키워드 추출 실패: ${error.message}`;
    showToast(`키워드 추출 실패: ${error.message}`);
    return null;
  }
}

async function searchQuestionSources() {
  const keywords = keywordInputList();
  const box = $("sourceResult");
  if (!keywords.length) {
    showToast("검색할 키워드를 입력해 주세요.");
    return;
  }

  try {
    box.textContent = "검색 슬롯 확인 중...";
    const res = await fetch(`${SERVER_API_BASE}/api/questions/search-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keywords }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || "검색 실패");
    lastQuestionSources = payload.sources || [];
    box.innerHTML = lastQuestionSources.map(src =>
      `• ${escapeHtml(src.title)}\n  - 상태: ${escapeHtml(src.status)}\n  - 메모: ${escapeHtml(src.note)}`
    ).join("\n\n") || "검색 슬롯 결과 없음";
    showToast("검색 슬롯 확인 완료");
  } catch (error) {
    box.textContent = `검색 실패: ${error.message}`;
    showToast(`검색 실패: ${error.message}`);
  }
}

async function generateQuestionsFromApi(options = {}) {
  if (!requireQuestionLogin()) return null;
  const keywords = Array.isArray(options.keywords) && options.keywords.length
    ? options.keywords
    : (lastQuestionMaterial?.keywords?.length ? lastQuestionMaterial.keywords : keywordInputList());
  if (!keywords.length) {
    showToast("문제 생성에 사용할 키워드를 입력해 주세요.");
    return null;
  }

  const subjectId = $("questionSubjectSelect")?.value || "";
  const subjectName = selectedQuestionSubjectName();
  const count = keywords.length;
  const difficulty = "medium";
  const title = `${subjectName || "공통"} 키워드별 대표문제`;

  try {
    const output = $("questionOutput");
    output.textContent = "키워드별 대표문제를 생성하는 중...";
    const res = await fetch(`${SERVER_API_BASE}/api/questions/generate`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        subject_id: subjectId,
        subject: subjectName,
        school_level: $("questionSchoolLevelSelect")?.value || "",
        user_prompt: $("questionUserPromptInput")?.value || "",
        material_id: options.material?.material_id || lastQuestionMaterial?.material_id || null,
        title,
        keywords,
        count,
        question_type: "representative",
        difficulty,
        sources: lastQuestionSources,
      }),
    });
    const payload = await res.json();
    if (!res.ok) {
      const detail = payload.detail ? `\n${payload.detail}` : "";
      throw new Error(`${payload.error || "문제 생성 실패"}${detail}`);
    }
    renderQuestionSet(payload);
    loadProfileQuestionSets({ silent: true });
    showToast("예상 문제 생성 완료. 마이페이지에도 저장되었습니다.");
    return payload;
  } catch (error) {
    const output = $("questionOutput");
    if (output) output.textContent = `문제 생성 실패: ${error.message}`;
    showToast(`문제 생성 실패: ${error.message}`);
    return null;
  }
}

async function analyzeAndGenerateQuestions() {
  const btn = $("generateQuestionsBtn");
  const output = $("questionOutput");
  try {
    if (btn) btn.disabled = true;
    if (output) output.textContent = "PDF 분석과 대표문제 생성을 진행하는 중...";
    const material = await uploadQuestionMaterial({ silent: true });
    if (!material) return null;
    const keywords = Array.isArray(material.keywords) ? material.keywords : [];
    return await generateQuestionsFromApi({ material, keywords });
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderQuestionSet(set, target = $("questionOutput")) {
  const output = typeof target === "string" ? $(target) : target;
  if (!output) return;
  const allQuestions = Array.isArray(set.questions) ? set.questions : [];
  const questions = allQuestions.filter(q => String(q.confidence || "").toLowerCase() !== "low");
  const keywordList = questions.map(q => q.keyword).filter(Boolean);
  if (!questions.length) {
    output.innerHTML = `
      <article class="question-set-card">
        <h4>${escapeHtml(set.title || "키워드별 대표문제")}</h4>
        <div class="question-meta">표시할 수 있는 신뢰도의 대표문제가 없습니다.</div>
        <p class="empty-text">PDF 범위, 과목명, 추가 조건을 더 구체적으로 입력한 뒤 다시 생성해 주세요.</p>
      </article>
    `;
    return;
  }
  output.innerHTML = `
    <article class="question-set-card">
      <h4>${escapeHtml(set.title || "키워드별 대표문제")}</h4>
      <div class="question-meta">생성일: ${escapeHtml(set.created_at || "")} · 문제 ${questions.length}개</div>
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

function renderProfileQuestionSetList(sets) {
  const list = $("profileQuestionSets");
  if (!list) return;
  if (!sets.length) {
    list.textContent = "아직 저장된 예상문제가 없습니다.";
    return;
  }
  list.innerHTML = sets.map(set => {
    const keywords = Array.isArray(set.keywords) ? set.keywords.slice(0, 4).join(", ") : "";
    const viewed = set.last_viewed_at || set.created_at || "";
    return `
      <a class="profile-question-item" href="question-set.html?id=${encodeURIComponent(set.id)}" target="_blank" rel="noopener">
        <strong>${escapeHtml(set.title || "저장된 예상문제")}</strong>
        <span>생성일 ${escapeHtml(set.created_at || "")}</span>
        <small>${escapeHtml(keywords || "키워드 없음")} · 최근 조회 ${escapeHtml(viewed)}</small>
      </a>
    `;
  }).join("");
}

async function loadProfileQuestionSets(options = {}) {
  const list = $("profileQuestionSets");
  if (!list || !authState.token) return;
  if (!options.silent) list.textContent = "저장된 예상문제를 불러오는 중...";
  try {
    const res = await fetch(`${SERVER_API_BASE}/api/questions/sets`, { headers: authHeaders(), cache: "no-store" });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || "목록 불러오기 실패");
    const sets = payload.sets || [];
    renderProfileQuestionSetList(sets);
  } catch (error) {
    list.textContent = `문제 목록 불러오기 실패: ${error.message}`;
  }
}


// ===== SQLite 서버 연동: 상태 저장 / 불러오기 =====
const SERVER_API_BASE = "";
let isHydratingFromServer = false;
let lastSavedSnapshot = "";
let autoSaveTimer = null;
const AUTO_SAVE_INTERVAL_MS = 3000;

const AUTH_TOKEN_KEY = "smartstudy_auth_token";
const GUEST_STATE_KEY = "smartstudy_guest_state";
const authState = {
  token: localStorage.getItem(AUTH_TOKEN_KEY) || "",
  user: null,
};
let authMode = "login";

function authHeaders(extra = {}) {
  return authState.token ? { ...extra, Authorization: `Bearer ${authState.token}` } : extra;
}

function calendarTokenCount() {
  return Object.values(state.plans || {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
}

function firstProfileLetter() {
  const source = authState.user?.name || authState.user?.email || "♡";
  return source.trim().charAt(0).toUpperCase() || "♡";
}

function updateAuthUi() {
  const btn = $("authButton");
  if (!btn) return;
  if (authState.user) {
    btn.textContent = firstProfileLetter();
    btn.title = "프로필";
    btn.classList.add("logged-in");
  } else {
    btn.textContent = "로그인";
    btn.title = "로그인";
    btn.classList.remove("logged-in");
  }
  renderAuthModal();
}

function setAuthMode(mode) {
  authMode = mode === "register" ? "register" : "login";
  const isRegister = authMode === "register";

  if ($("authModalTitle")) $("authModalTitle").textContent = isRegister ? "회원가입" : "로그인";
  if ($("authModeDesc")) {
    $("authModeDesc").textContent = isRegister
      ? "새 계정을 만들면 캘린더와 예상문제 생성 기록이 사용자별 SQLite DB에 저장됩니다."
      : "로그인하면 캘린더와 예상문제 생성 기록이 사용자별 SQLite DB에 저장됩니다.";
  }

  const nameLabel = $("authNameLabel");
  const confirmLabel = $("authPasswordConfirmLabel");
  const loginBtn = $("loginBtn");
  const registerBtn = $("registerBtn");
  const loginTab = $("authLoginTab");
  const registerTab = $("authRegisterTab");

  if (nameLabel) nameLabel.hidden = !isRegister;
  if (confirmLabel) confirmLabel.hidden = !isRegister;
  if (loginBtn) loginBtn.hidden = isRegister;
  if (registerBtn) registerBtn.hidden = !isRegister;

  if (loginTab) {
    loginTab.classList.toggle("active", !isRegister);
    loginTab.setAttribute("aria-selected", String(!isRegister));
  }
  if (registerTab) {
    registerTab.classList.toggle("active", isRegister);
    registerTab.setAttribute("aria-selected", String(isRegister));
  }

  if ($("authPasswordInput")) {
    $("authPasswordInput").autocomplete = isRegister ? "new-password" : "current-password";
  }
  if ($("authEmailInput")) {
    $("authEmailInput").placeholder = isRegister ? "회원가입에 사용할 이메일 또는 아이디" : "예: user@example.com";
  }
}

function renderAuthModal() {
  const loggedOut = $("authLoggedOutPanel");
  const loggedIn = $("authLoggedInPanel");
  if (!loggedOut || !loggedIn) return;
  const isLoggedIn = !!authState.user;
  loggedOut.hidden = isLoggedIn;
  loggedIn.hidden = !isLoggedIn;
  if (!isLoggedIn) setAuthMode(authMode);
  if (isLoggedIn) {
    if ($("profileName")) $("profileName").textContent = authState.user.name || "사용자";
    if ($("profileEmail")) $("profileEmail").textContent = authState.user.email || "";
    if ($("profileSubjectCount")) $("profileSubjectCount").textContent = String(state.subjects.length);
    if ($("profilePlanCount")) $("profilePlanCount").textContent = String(calendarTokenCount());
    loadProfileQuestionSets({ silent: true });
  }
}

function openAuthModal() {
  renderAuthModal();
  const modal = $("authModal");
  if (modal) {
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }
}

function closeAuthModal() {
  const modal = $("authModal");
  if (modal) {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }
}

function authPayload() {
  return {
    name: ($("authNameInput")?.value || "").trim(),
    email: ($("authEmailInput")?.value || "").trim(),
    password: $("authPasswordInput")?.value || "",
    passwordConfirm: $("authPasswordConfirmInput")?.value || "",
  };
}

async function initAuthState() {
  if (!authState.token) {
    updateAuthUi();
    return false;
  }
  try {
    const res = await fetch(`${SERVER_API_BASE}/api/auth/me`, { headers: authHeaders(), cache: "no-store" });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || "인증 실패");
    authState.user = payload.user;
    updateAuthUi();
    return true;
  } catch (error) {
    authState.token = "";
    authState.user = null;
    localStorage.removeItem(AUTH_TOKEN_KEY);
    updateAuthUi();
    return false;
  }
}

async function submitAuth(mode) {
  const payload = authPayload();
  if (!payload.email || !payload.password) {
    showToast("이메일/아이디와 비밀번호를 입력해 주세요.");
    return;
  }
  if (mode === "register") {
    if (!payload.name) payload.name = "SmartStudy 사용자";
    if (payload.password.length < 4) {
      showToast("비밀번호는 4자 이상으로 입력해 주세요.");
      return;
    }
    if (payload.password !== payload.passwordConfirm) {
      showToast("비밀번호 확인이 일치하지 않습니다.");
      return;
    }
  }
  delete payload.passwordConfirm;
  try {
    const authEndpoint = mode === "register" ? "/api/auth/register" : "/api/auth/login";
    const res = await fetch(`${SERVER_API_BASE}${authEndpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "인증 실패");
    authState.token = data.token;
    authState.user = data.user;
    localStorage.setItem(AUTH_TOKEN_KEY, authState.token);
    updateAuthUi();
    await loadStateFromServer(true);
    if ($("authPasswordInput")) $("authPasswordInput").value = "";
    if ($("authPasswordConfirmInput")) $("authPasswordConfirmInput").value = "";
    if ($("authNameInput")) $("authNameInput").value = "";
    showToast(mode === "register" ? "회원가입 완료. 자동 로그인되었습니다." : "로그인 완료");
  } catch (error) {
    showToast(error.message);
  }
}

async function logout() {
  try {
    if (authState.token) {
      await fetch(`${SERVER_API_BASE}/api/auth/logout`, { method: "POST", headers: authHeaders() });
    }
  } catch (error) {
    console.warn("로그아웃 요청 실패", error);
  }
  authState.token = "";
  authState.user = null;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  lastSavedSnapshot = "";
  updateAuthUi();
  showToast("로그아웃했습니다. 현재 화면 데이터는 이 창에서만 임시 저장됩니다.");
}

function setToArray(value) {
  return Array.from(value || []);
}

function normalizeDateSet(value) {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value);
  return new Set();
}

function serializeAppState() {
  return {
    categories: state.categories.map(c => ({
      ...c,
      blockedDates: setToArray(c.blockedDates),
    })),
    subjects: state.subjects.map(s => ({
      ...s,
      blockedDates: setToArray(s.blockedDates),
    })),
    plans: state.plans,
    globalBlockedDates: setToArray(state.globalBlockedDates),
    completionLog: state.completionLog || {},
    displayYear: state.displayYear,
    displayMonth: state.displayMonth,
    weekStart: state.weekStart,
    calendarMode: state.calendarMode,
    selectedAdjustCategoryId: state.selectedAdjustCategoryId,
    selectedAdjustSubjectId: state.selectedAdjustSubjectId,
    adjustDisplayYear: state.adjustDisplayYear,
    adjustDisplayMonth: state.adjustDisplayMonth,
    adjustSelectedDate: state.adjustSelectedDate,
  };
}

function hydrateAppState(saved) {
  if (!saved || typeof saved !== "object") return false;

  isHydratingFromServer = true;

  state.categories = Array.isArray(saved.categories) && saved.categories.length
    ? saved.categories.map(c => ({
        id: c.id,
        name: c.name,
        color: c.color,
        blockedDates: normalizeDateSet(c.blockedDates),
      }))
    : state.categories;

  state.subjects = Array.isArray(saved.subjects)
    ? saved.subjects.map(s => ({
        ...s,
        blockedDates: normalizeDateSet(s.blockedDates),
      }))
    : [];

  state.plans = saved.plans && typeof saved.plans === "object" ? saved.plans : {};
  state.globalBlockedDates = normalizeDateSet(saved.globalBlockedDates);
  state.completionLog = saved.completionLog && typeof saved.completionLog === "object" ? saved.completionLog : {};

  state.displayYear = saved.displayYear || state.displayYear;
  state.displayMonth = saved.displayMonth || state.displayMonth;
  state.weekStart = saved.weekStart || state.weekStart;
  state.calendarMode = saved.calendarMode || state.calendarMode || "week";
  state.selectedAdjustCategoryId = saved.selectedAdjustCategoryId || state.selectedAdjustCategoryId;
  state.selectedAdjustSubjectId = saved.selectedAdjustSubjectId || state.selectedAdjustSubjectId;
  state.adjustDisplayYear = saved.adjustDisplayYear || state.adjustDisplayYear;
  state.adjustDisplayMonth = saved.adjustDisplayMonth || state.adjustDisplayMonth;
  state.adjustSelectedDate = saved.adjustSelectedDate || state.adjustSelectedDate;

  isHydratingFromServer = false;
  return true;
}

function loadGuestState() {
  try {
    localStorage.removeItem(GUEST_STATE_KEY);
    const raw = sessionStorage.getItem(GUEST_STATE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    const ok = hydrateAppState(saved);
    if (ok) lastSavedSnapshot = JSON.stringify(serializeAppState());
    return ok;
  } catch (error) {
    console.warn("게스트 임시 상태 불러오기 실패", error);
    return false;
  }
}

function renderAppAfterStateChange() {
  refreshCategorySelects();
  renderSubjects();
  renderSubjectManagement();
  renderQuestionSubjectOptions();
  renderCalendar();
  renderAdjustView();
  renderAuthModal();
  renderHome();
}

async function loadStateFromServer(afterLogin = false) {
  if (!authState.token) {
    lastSavedSnapshot = "";
    loadGuestState();
    return;
  }
  try {
    const currentLocalSnapshot = JSON.stringify(serializeAppState());
    const res = await fetch(`${SERVER_API_BASE}/api/state`, { headers: authHeaders(), cache: "no-store" });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || `서버 응답 오류: ${res.status}`);
    if (payload && payload.state) {
      hydrateAppState(payload.state);
      lastSavedSnapshot = JSON.stringify(serializeAppState());
      sessionStorage.removeItem(GUEST_STATE_KEY);
      localStorage.removeItem(GUEST_STATE_KEY);
      showToast("로그인 계정의 캘린더 DB를 불러왔습니다.");
    } else if (afterLogin) {
      lastSavedSnapshot = "";
      // 서버에 저장된 상태가 없는 새 계정이면 현재 화면/게스트 상태를 계정 DB에 처음 저장합니다.
      await saveStateToServer(true);
      sessionStorage.removeItem(GUEST_STATE_KEY);
      localStorage.removeItem(GUEST_STATE_KEY);
      showToast("현재 캘린더 상태를 새 계정 DB에 저장했습니다.");
    } else {
      lastSavedSnapshot = currentLocalSnapshot;
    }
    renderAppAfterStateChange();
  } catch (error) {
    console.warn("DB 상태 불러오기 실패", error);
    showToast(`DB 불러오기 실패: ${error.message}`);
  }
}

async function saveStateToServer(force = false) {
  if (isHydratingFromServer) return;
  const appState = serializeAppState();
  const snapshot = JSON.stringify(appState);
  if (!force && snapshot === lastSavedSnapshot) return;

  if (!authState.token) {
    try {
      localStorage.removeItem(GUEST_STATE_KEY);
      sessionStorage.setItem(GUEST_STATE_KEY, snapshot);
      lastSavedSnapshot = snapshot;
    } catch (error) {
      console.warn("게스트 임시 상태 저장 실패", error);
    }
    return;
  }

  try {
    const res = await fetch(`${SERVER_API_BASE}/api/state`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ state: appState }),
    });
    if (!res.ok) throw new Error(`서버 응답 오류: ${res.status}`);
    lastSavedSnapshot = snapshot;
    sessionStorage.removeItem(GUEST_STATE_KEY);
    localStorage.removeItem(GUEST_STATE_KEY);
  } catch (error) {
    console.warn("DB 상태 저장 실패", error);
  }
}

function startAutoSave() {
  clearInterval(autoSaveTimer);
  autoSaveTimer = setInterval(saveStateToServer, AUTO_SAVE_INTERVAL_MS);
  window.addEventListener("beforeunload", () => {
    const appState = serializeAppState();
    const snapshot = JSON.stringify(appState);
    if (!authState.token) {
      try {
        localStorage.removeItem(GUEST_STATE_KEY);
        sessionStorage.setItem(GUEST_STATE_KEY, snapshot);
      } catch (error) {}
      return;
    }
    if (snapshot !== lastSavedSnapshot && navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify({ state: appState })], { type: "application/json" });
      navigator.sendBeacon(`${SERVER_API_BASE}/api/state/beacon?token=${encodeURIComponent(authState.token)}`, blob);
    }
  });
}

async function backupDatabase() {
  try {
    const res = await fetch(`${SERVER_API_BASE}/api/backup`, { method: "POST", headers: authHeaders() });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || "백업 실패");
    showToast(`DB 백업 완료: ${payload.file}`);
  } catch (error) {
    showToast(`DB 백업 실패: ${error.message}`);
  }
}

window.backupDatabase = backupDatabase;

// ===== 동기부여 명언 50가지 =====
const STUDY_QUOTES = [
  { text: "배움에는 끝이 없다.", author: "공자" },
  { text: "오늘의 공부는 내일의 희망이다.", author: "아인슈타인" },
  { text: "교육은 세상을 바꿀 수 있는 가장 강력한 무기다.", author: "넬슨 만델라" },
  { text: "성공은 준비된 자에게 찾아온다.", author: "아브라함 링컨" },
  { text: "계속 도전하고 실패하라, 그리고 다시 도전하라.", author: "윈스턴 처칠" },
  { text: "지식은 힘이다.", author: "프란시스 베이컨" },
  { text: "배우는 것을 멈추지 않는 자는 늙지 않는다.", author: "헨리 포드" },
  { text: "어제보다 더 나은 오늘을 만들어라.", author: "알버트 슈바이처" },
  { text: "성공은 매일 반복한 작은 노력의 결과다.", author: "로버트 콜리어" },
  { text: "노력 없이 얻을 수 있는 것은 없다.", author: "마호메트" },
  { text: "위대한 일은 작은 일들이 모여 이루어진다.", author: "빈센트 반 고흐" },
  { text: "실패는 성공의 어머니이다.", author: "토마스 에디슨" },
  { text: "자기 자신을 이기는 것이 가장 큰 승리다.", author: "플라톤" },
  { text: "꿈을 꾸는 자는 멈추지 않는다.", author: "마틴 루터 킹 주니어" },
  { text: "지식은 실천으로 완성된다.", author: "존 듀이" },
  { text: "어려움은 새로운 기회를 만든다.", author: "알베르트 아인슈타인" },
  { text: "큰 목표는 작은 발걸음에서 시작된다.", author: "라오쯔" },
  { text: "미래는 오늘 무엇을 하는가에 달려 있다.", author: "마하트마 간디" },
  { text: "자신을 믿어라, 그리고 자신에게 도전하라.", author: "앤드류 카네기" },
  { text: "성공은 열정 없이는 불가능하다.", author: "존 C. 맥스웰" },
  { text: "자신의 한계를 정하지 말라.", author: "브루스 리" },
  { text: "가장 어두운 밤이 지나야 새벽이 온다.", author: "토마스 풀러" },
  { text: "배움은 일생을 통해 지속되어야 한다.", author: "헨리 애덤스" },
  { text: "꿈을 향해 나아가라. 그것은 네가 생각하는 것보다 더 가까이 있다.", author: "해리엇 비처 스토우" },
  { text: "지식은 힘이고, 인내는 무기다.", author: "아리스토텔레스" },
  { text: "성공은 준비된 사람에게 온다.", author: "루이 파스퇴르" },
  { text: "노력은 결코 배신하지 않는다.", author: "안철수" },
  { text: "작은 것들이 모여 큰 성과를 이룬다.", author: "다비드 스타흐" },
  { text: "어려운 길이 결국 더 아름다운 목적지로 이끈다.", author: "파울로 코엘료" },
  { text: "오늘 걷지 않으면 내일은 뛰어야 한다.", author: "존 우든" },
  { text: "꿈은 이루어질 때까지 멈추지 말라.", author: "월트 디즈니" },
  { text: "성공은 노력과 기회가 만날 때 찾아온다.", author: "바비 언서" },
  { text: "배움의 길은 끝이 없다.", author: "빌 게이츠" },
  { text: "자신을 믿어라. 그것이 성공의 첫 번째 비결이다.", author: "벤저민 프랭클린" },
  { text: "지금 공부하지 않으면 나중에 후회한다.", author: "익명" },
  { text: "미래는 당신이 오늘 무엇을 하는가에 달려 있다.", author: "스티브 잡스" },
  { text: "성공은 포기하지 않는 자에게 온다.", author: "오귀스트 로댕" },
  { text: "열정은 모든 성공의 밑바탕이다.", author: "아놀드 토인비" },
  { text: "배움에는 나이가 없다.", author: "아리스토텔레스" },
  { text: "작은 승리가 큰 승리로 이끈다.", author: "빌리 콕스" },
  { text: "실패는 성공의 일부다.", author: "헨리 포드" },
  { text: "공부는 반복이다.", author: "히포크라테스" },
  { text: "지식은 쌓아야 할 보물이다.", author: "존 록" },
  { text: "배움은 희망이다.", author: "엘레나 페리" },
  { text: "성공은 단지 꿈이 아니라 계획된 노력의 결과다.", author: "리처드 브랜슨" },
  { text: "끊임없이 배우는 자가 강해진다.", author: "존 듀이" },
  { text: "지식을 쌓는 것은 인생을 풍요롭게 한다.", author: "랄프 왈도 에머슨" },
  { text: "공부는 나를 발전시키는 길이다.", author: "익명" },
  { text: "미래는 당신이 지금 무엇을 하는가에 달려 있다.", author: "에이브러햄 링컨" },
  { text: "성공은 스스로 이루어지는 것이 아니다.", author: "마이크 로이코" },
];

function randomQuote() {
  return STUDY_QUOTES[Math.floor(Math.random() * STUDY_QUOTES.length)];
}

// ===== 개선 전략 리포트 =====
function isExamPassed(subject) {
  return subject.examDate && subject.examDate < todayString();
}

function analyzeStudyPattern(subject) {
  const plan = state.plans[subject.id] || [];
  const log = state.completionLog || {};

  const stageStats = plan.map((stage, i) => {
    const dates = Array.isArray(stage.actualDates) ? stage.actualDates : [];
    const completed = dates.filter(d => log[d]?.[subject.id] === true).length;
    const missed = dates.filter(d => log[d]?.[subject.id] === false).length;
    return { name: stage.name, total: dates.length, completed, missed, index: i };
  });

  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const missedDayCount = [0,0,0,0,0,0,0];
  for (const dateStr of Object.keys(log)) {
    if (log[dateStr]?.[subject.id] === false) {
      missedDayCount[parseDate(dateStr).getDay()]++;
    }
  }
  const worstDayIdx = missedDayCount.indexOf(Math.max(...missedDayCount));
  const worstDay = missedDayCount[worstDayIdx] > 0 ? dayNames[worstDayIdx] : null;

  const prog = calcSubjectProgress(subject);
  const weakStage = stageStats.length
    ? stageStats.reduce((a, b) => (b.missed > a.missed ? b : a))
    : null;

  const typeLabels = {
    cram_2weeks: "벼락치기형 (2주)",
    steady_3to4weeks: "꾸준형 (3~4주)",
    early_6weeks: "미리 준비형 (6주)",
  };
  let recommendedType = subject.studyType;
  let strategyMsg = "";
  if (prog.rate >= 80) {
    strategyMsg = "현재 학습 방식이 잘 맞습니다. 다음 시험도 같은 유형을 유지하세요. 💪";
  } else if (prog.rate >= 50) {
    strategyMsg = `미수행이 잦았던 구간을 보강하세요.${weakStage ? ` 특히 '${weakStage.name}' 단계가 약했습니다.` : ""}`;
    if (subject.studyType === "early_6weeks") recommendedType = "steady_3to4weeks";
  } else {
    strategyMsg = "일일 공부 시간을 줄이고 회독 수를 낮추는 게 현실적입니다. 부담을 줄여보세요.";
    recommendedType = "cram_2weeks";
  }

  const typeChanged = recommendedType !== subject.studyType;
  return {
    prog, stageStats, worstDay, weakStage, strategyMsg,
    recommendedTypeLabel: typeLabels[recommendedType] || recommendedType,
    currentTypeLabel: typeLabels[subject.studyType] || subject.studyType,
    typeChanged,
  };
}

function renderImprovementReport(subject) {
  if (!isExamPassed(subject)) return "";
  const { prog, stageStats, worstDay, weakStage, strategyMsg, recommendedTypeLabel, currentTypeLabel, typeChanged } = analyzeStudyPattern(subject);
  const quote = randomQuote();

  const stageRows = stageStats.map((st, i) => {
    const style = planStageStyle(i, st.name);
    const pct = st.total ? Math.round((st.completed / st.total) * 100) : 0;
    const missPct = st.total ? Math.round((st.missed / st.total) * 100) : 0;
    return `
      <div class="rpt-stage-row">
        <span class="rpt-stage-label">${style.icon} ${st.name}</span>
        <div class="rpt-bar-wrap">
          <div class="rpt-bar-fill" style="width:${pct}%; background:${style.accent};"></div>
          <div class="rpt-bar-miss" style="left:${pct}%; width:${missPct}%;"></div>
        </div>
        <span class="rpt-stage-pct">${pct}%</span>
      </div>`;
  }).join("");

  const blockedCount = getSubjectBlockedDates(subject).size;

  return `
    <div class="improvement-report">
      <div class="rpt-header">
        <span class="rpt-title">📋 다음 시험을 위한 개선 전략</span>
        <span class="rpt-badge">시험 종료</span>
      </div>

      <div class="rpt-quote">
        <span class="rpt-quote-icon">💬</span>
        <div>
          <div class="rpt-quote-text">"${quote.text}"</div>
          <div class="rpt-quote-author">— ${quote.author}</div>
        </div>
      </div>

      <div class="rpt-section">
        <div class="rpt-section-title">① 전체 달성 요약</div>
        <div class="rpt-summary-row">
          <div class="rpt-summary-item rpt-done">✅ 완료<strong>${prog.rate}%</strong></div>
          <div class="rpt-summary-item rpt-miss">❌ 미수행<strong>${prog.missedTokens}회</strong></div>
          <div class="rpt-summary-item rpt-pend">⬜ 미체크<strong>${prog.uncheckedTokens}회</strong></div>
          <div class="rpt-summary-item rpt-block">🚫 불가일<strong>${blockedCount}일</strong></div>
        </div>
      </div>

      <div class="rpt-section">
        <div class="rpt-section-title">② 회독 단계별 성취</div>
        ${stageRows || '<p style="font-size:0.8rem;color:#3d9e94;">캘린더 데이터가 없습니다.</p>'}
        <div class="rpt-legend-row">
          <span><i class="rpt-dot" style="background:#4aa89e;"></i>완료</span>
          <span><i class="rpt-dot" style="background:#f9b8b5;"></i>미수행</span>
        </div>
      </div>

      <div class="rpt-section">
        <div class="rpt-section-title">③ 약점 패턴 분석</div>
        ${worstDay ? `<div class="rpt-insight-item">📅 <strong>${worstDay}요일</strong>에 미수행이 가장 많았습니다.</div>` : ""}
        ${weakStage && weakStage.missed > 0 ? `<div class="rpt-insight-item">⚠️ <strong>'${weakStage.name}'</strong> 단계에서 미수행이 ${weakStage.missed}회로 가장 많았습니다.</div>` : ""}
        ${blockedCount > 0 ? `<div class="rpt-insight-item">📌 공부 불가일이 <strong>${blockedCount}일</strong> 설정되었습니다.</div>` : ""}
        ${!worstDay && !(weakStage && weakStage.missed > 0) ? `<div class="rpt-insight-item" style="color:#3d9e94;">미수행 기록이 없습니다. 완벽한 출석! 🎉</div>` : ""}
      </div>

      <div class="rpt-section">
        <div class="rpt-section-title">④ 다음 시험 전략 제안</div>
        <div class="rpt-strategy-box">${strategyMsg}</div>
        ${typeChanged
          ? `<div class="rpt-insight-item">🔄 <strong>${currentTypeLabel} → ${recommendedTypeLabel}</strong> 으로 변경을 고려해보세요.</div>`
          : `<div class="rpt-insight-item">✅ <strong>${currentTypeLabel}</strong> 유형이 잘 맞습니다. 유지하세요.</div>`
        }
      </div>
    </div>`;
}

function renderReport() {
  const report = $("reportText");
  if (!report) return;

  const totalStages = Object.values(state.plans).flat().length;
  const blockedCount = state.subjects.reduce((sum, s) => sum + getSubjectBlockedDates(s).size, 0);

  report.textContent =
    `현재 등록 과목은 ${state.subjects.length}개, 카테고리는 ${state.categories.length}개입니다. ` +
    `생성된 회독 단계는 총 ${totalStages}개이며, 과목별 공부 불가일은 총 ${blockedCount}개입니다.`;
}

window.deleteSubject = deleteSubject;
window.removeBlockedDate = removeBlockedDate;

document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

document.querySelectorAll("[data-action='open-calendar']").forEach(btn => {
  btn.addEventListener("click", () => showView("calendar"));
});

document.querySelectorAll("[data-action='open-subjects']").forEach(btn => {
  btn.addEventListener("click", () => showView("subjects"));
});

document.querySelectorAll("[data-action='open-adjust']").forEach(btn => {
  btn.addEventListener("click", () => showView("adjust"));
});

document.querySelectorAll("[data-action='open-questions']").forEach(btn => {
  btn.addEventListener("click", () => showView("questions"));
});

document.querySelectorAll(".back-home").forEach(btn => {
  btn.addEventListener("click", () => showView("home"));
});

if ($("addSubjectBtn")) $("addSubjectBtn").addEventListener("click", addSubject);
if ($("clearSubjectsBtn")) $("clearSubjectsBtn").addEventListener("click", clearSubjects);
if ($("sampleBtn")) $("sampleBtn").addEventListener("click", fillSample);
if ($("prevMonthBtn")) $("prevMonthBtn").addEventListener("click", () => shiftMonth(-1));
if ($("nextMonthBtn")) $("nextMonthBtn").addEventListener("click", () => shiftMonth(1));
if ($("monthViewBtn")) $("monthViewBtn").addEventListener("click", () => setCalendarMode("month"));
if ($("weekViewBtn")) $("weekViewBtn").addEventListener("click", () => setCalendarMode("week"));
if ($("adjustPrevBtn")) $("adjustPrevBtn").addEventListener("click", () => shiftAdjustMonth(-1));
if ($("adjustNextBtn")) $("adjustNextBtn").addEventListener("click", () => shiftAdjustMonth(1));
if ($("goTodayBtn")) $("goTodayBtn").addEventListener("click", () => {
  const d = parseDate(todayString());
  state.adjustDisplayYear = d.getFullYear();
  state.adjustDisplayMonth = d.getMonth() + 1;
  state.adjustSelectedDate = todayString();
  renderAdjustCalendar();
  renderAdjustDayDetail(todayString());
});
// 과목 관리 탭의 카테고리 UI는 제거되었으므로, 요소가 있을 때만 연결한다.
if ($("addCategoryBtn")) $("addCategoryBtn").addEventListener("click", addCategory);
if ($("uploadMaterialBtn")) $("uploadMaterialBtn").addEventListener("click", uploadQuestionMaterial);
if ($("searchQuestionSourcesBtn")) $("searchQuestionSourcesBtn").addEventListener("click", searchQuestionSources);
if ($("generateQuestionsBtn")) $("generateQuestionsBtn").addEventListener("click", analyzeAndGenerateQuestions);
if ($("refreshProfileQuestionSetsBtn")) $("refreshProfileQuestionSetsBtn").addEventListener("click", () => loadProfileQuestionSets());
if ($("authButton")) $("authButton").addEventListener("click", openAuthModal);
document.querySelectorAll("[data-auth-close]").forEach(el => el.addEventListener("click", closeAuthModal));
if ($("authLoginTab")) $("authLoginTab").addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  setAuthMode("login");
});
if ($("authRegisterTab")) $("authRegisterTab").addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  setAuthMode("register");
});
if ($("loginBtn")) $("loginBtn").addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  submitAuth("login");
});
if ($("registerBtn")) $("registerBtn").addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  submitAuth("register");
});
if ($("logoutBtn")) $("logoutBtn").addEventListener("click", logout);
["authNameInput", "authEmailInput", "authPasswordInput", "authPasswordConfirmInput"].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener("keydown", e => {
    if (e.key === "Enter") submitAuth(authMode);
  });
});

async function checkServerHealth() {
  if (!location.protocol.startsWith("http")) {
    showToast("DB를 쓰려면 index.html을 직접 열지 말고 python server.py로 실행한 주소에서 접속하세요.");
    return false;
  }
  try {
    const res = await fetch(`${SERVER_API_BASE}/api/health`, { cache: "no-store" });
    const payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.error || "DB 상태 확인 실패");
    console.info("SmartStudy DB 연결됨", payload.db);
    return true;
  } catch (error) {
    console.warn("서버/DB 상태 확인 실패", error);
    showToast("서버 DB 연결을 확인하지 못했습니다. python server.py로 실행했는지 확인하세요.");
    return false;
  }
}

// ===== 홈 대시보드 =====

function calcStreak() {
  let streak = 0;
  const today = parseDate(todayString());
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = formatDate(d);
    const log = state.completionLog[dateStr] || {};
    const hasAnyDone = Object.values(log).some(v => v === true);
    if (hasAnyDone) {
      streak++;
    } else if (i > 0) {
      break;
    }
  }
  return streak;
}

function calcOverallProgress() {
  if (!state.subjects.length || !Object.keys(state.plans).length) return null;
  let total = 0, completed = 0;
  for (const subject of state.subjects) {
    const prog = calcSubjectProgress(subject);
    total += prog.totalTokens;
    completed += prog.completedTokens;
  }
  if (total === 0) return null;
  return Math.round((completed / total) * 100);
}

function renderHome() {
  const container = $("homeView");
  if (!container) return;

  const today = todayString();
  const streak = calcStreak();
  const overallPct = calcOverallProgress();
  const hasPlan = Object.keys(state.plans).length > 0;

  // 스트릭 이모티콘/문구
  const streakEmoji = streak >= 7 ? "🔥" : streak >= 3 ? "⚡" : "✨";
  const streakMsg = streak === 0
    ? "오늘 첫 체크를 해보세요!"
    : streak === 1
    ? "오늘도 공부했어요! 내일도 이어가요 💪"
    : `${streak}일 연속 공부 중이에요!`;

  // D-day 과목 목록 (임박순 정렬)
  const subjectsSorted = [...state.subjects]
    .filter(s => s.examDate >= today)
    .sort((a, b) => getDaysUntil(a.examDate) - getDaysUntil(b.examDate));

  const ddayCards = subjectsSorted.length === 0
    ? `<div class="home-empty">등록된 시험 일정이 없습니다.<br/><button class="home-goto-btn" onclick="showView('calendar')">학습 일정 생성하러 가기 →</button></div>`
    : subjectsSorted.map(s => {
        const diff = getDaysUntil(s.examDate);
        const color = getCategoryColor(s.categoryId);
        const prog = hasPlan ? calcSubjectProgress(s) : null;
        const urgency = diff <= 3 ? "dday-urgent" : diff <= 7 ? "dday-warn" : "dday-normal";
        return `
          <div class="home-dday-card ${urgency}" style="--dday-color:${color}">
            <div class="home-dday-left">
              <div class="home-dday-name">${s.name}</div>
              <div class="home-dday-date">${s.examDate} · ${getCategoryName(s.categoryId)}</div>
              ${prog && prog.totalTokens > 0 ? `
                <div class="home-dday-prog-bar">
                  <div class="home-dday-prog-fill" style="width:${prog.rate}%; background:${color};"></div>
                </div>` : ""}
            </div>
            <div class="home-dday-right">
              <div class="home-dday-label">${formatDday(s.examDate)}</div>
              ${prog && prog.totalTokens > 0 ? `<div class="home-dday-pct">${prog.rate}% 완료</div>` : ""}
            </div>
          </div>`;
      }).join("");

  container.innerHTML = `
    <div class="home-dashboard">

      <div class="home-top-row">

        <div class="home-card home-streak-card">
          <div class="home-streak-number">${streakEmoji} ${streak}일</div>
          <div class="home-streak-label">연속 학습</div>
          <div class="home-streak-msg">${streakMsg}</div>
        </div>

        <div class="home-card home-progress-card">
          <div class="home-card-title">📊 전체 진행률</div>
          ${overallPct !== null
            ? `<div class="home-overall-ring" style="--ring-pct:${overallPct}; --ring-color:#6bbfb5;">
                <div class="home-overall-inner">
                  <strong>${overallPct}%</strong>
                  <span>달성</span>
                </div>
              </div>`
            : `<div class="home-empty-small">캘린더 생성 후 표시됩니다</div>`}
        </div>

        <div class="home-card home-shortcut-card">
          <div class="home-card-title">🔗 바로가기</div>
          <button class="home-shortcut-btn" onclick="showView('adjust')">📋 오늘 일정 체크</button>
          <button class="home-shortcut-btn" onclick="showView('calendar')">📅 학습 일정 생성</button>
          <button class="home-shortcut-btn" onclick="showView('subjects')">📊 과목 관리</button>
        </div>

      </div>

      <div class="home-section">
        <div class="home-section-title">⏰ 시험 D-day</div>
        <div class="home-dday-list">${ddayCards}</div>
      </div>

    </div>
  `;
}

async function bootApp() {
  initializeMonth();
  await checkServerHealth();
  await initAuthState();
  await loadStateFromServer();
  initializeMonth();
  initializeAdjustMonth();
  refreshCategorySelects();
  renderSubjects();
  renderSubjectManagement();
  renderQuestionSubjectOptions();
  renderCalendar();
  renderAdjustView();
  refreshSubjectActionUI();
  startAutoSave();
  renderHome();
}

bootApp();

// 캘린더 생성탭 → "학습 일정 생성" 탭 이름 패치 + 설명 문구 제거
// 학습 유형 드롭다운 옵션 텍스트에 기간 표기 추가
(function patchStudyTypeOptions() {
  const map = {
    cram_2weeks:      "벼락치기형 (2주)",
    steady_3to4weeks: "꾸준형 (3~4주)",
    early_6weeks:     "미리 준비형 (6주)",
  };
  const sel = $("studyType");
  if (!sel) return;
  Array.from(sel.options).forEach(opt => {
    if (map[opt.value]) opt.textContent = map[opt.value];
  });
})();


(function injectStyles() {
  const css = `
    /* 캘린더 생성탭: 공부 불가일 */
    .day.globally-blocked {
      background: #ece9e4 !important;
      opacity: 0.95;
      cursor: pointer;
    }
    .day.globally-blocked .day-number { color: #6f6660; font-weight: 700; }
    .blocked-x { font-size: 0.7em; color: #ef4444; margin-left: 2px; }
    .blocked-chip {
      background: #ded8d1 !important;
      color: #6f6660 !important;
      font-size: 0.68rem;
    }
    .day { cursor: pointer; }
    .day:hover { background: #fbf3ef; transition: background 0.15s; }
    .day.globally-blocked:hover { background: #e5e0da !important; }

    /* 일정 조정탭: 새 레이아웃 */
    .adjust-exec-layout {
      display: grid;
      grid-template-columns: 1fr 380px;
      gap: 1.25rem;
      align-items: start;
    }
    @media (max-width: 900px) {
      .adjust-exec-layout { grid-template-columns: 1fr; }
    }

    /* 조정 캘린더: 날짜 점 인디케이터 */
    .day-indicators { display: flex; gap: 3px; flex-wrap: wrap; min-height: 14px; margin-top: 2px; }
    .day-dot {
      width: 7px; height: 7px; border-radius: 50%;
      display: inline-block; flex-shrink: 0;
    }
    .blocked-dot { background: #b7aea6 !important; }
    .day-summary {
      font-size: 0.65rem; font-weight: 600;
      padding: 1px 4px; border-radius: 4px;
      line-height: 1.4;
    }
    .day-summary.done { background: #d1fae5; color: #065f46; }
    .day-summary.missed { background: #fee2e2; color: #991b1b; }
    .day.has-plan { cursor: pointer; }
    .day.selected-day {
      outline: 2px solid #4aa89e;
      outline-offset: -2px;
      background: #f0faf8;
    }
    .day.today .day-number { color: #4aa89e; font-weight: 800; }
    .today-dot {
      display: inline-block; width: 5px; height: 5px;
      background: #4aa89e; border-radius: 50;
      margin-left: 2px; vertical-align: middle;
    }

    /* 당일 학습 목록 패널 */
    .adjust-day-panel { min-height: 400px; }
    .day-detail-box { margin-top: 0.75rem; }
    .detail-empty {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; padding: 2.5rem 1rem;
      color: #94a3b8; text-align: center; gap: 0.75rem;
    }
    .detail-empty-icon { font-size: 2.5rem; }
    .detail-empty p { font-size: 0.9rem; line-height: 1.6; }
    .detail-header {
      display: flex; align-items: center; gap: 0.75rem;
      margin-bottom: 1rem;
    }
    .detail-header h3 { margin: 0; font-size: 1rem; }
    .detail-note {
      margin-top: 0.75rem; font-size: 0.78rem;
      color: #94a3b8; text-align: center;
    }
    .badge {
      font-size: 0.72rem; padding: 2px 8px; border-radius: 20px;
      font-weight: 600; white-space: nowrap;
    }
    .badge-plan { background: #e8f7f5; color: #4aa89e; }
    .badge-blocked { background: #e7e1db; color: #6f6660; }

    /* 태스크 아이템 */
    .task-list { display: flex; flex-direction: column; gap: 0.6rem; }
    .task-item {
      display: flex; align-items: stretch; gap: 0.75rem;
      border: 1px solid #e2e8f0; border-radius: 10px;
      overflow: hidden; transition: opacity 0.2s;
      background: #fff;
      position: relative;
    }
    .task-item.task-done { opacity: 0.55; }
    .task-item.task-missed { background: #fff5f5; border-color: #fecaca; }
    .task-delete-btn {
      position: absolute; top: 6px; right: 6px;
      width: 22px; height: 22px; border-radius: 50%;
      background: #f1f5f9; color: #94a3b8;
      border: 1px solid #e2e8f0;
      font-size: 15px; line-height: 1; font-weight: 900;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; z-index: 2;
    }
    .task-delete-btn:hover {
      background: #e5e7eb; color: #64748b;
      transform: scale(1.06);
    }
    .task-color-bar { width: 4px; flex-shrink: 0; }
    .task-info {
      flex: 1;
      order: 2;
      padding: 0.6rem 1.9rem 0.6rem 0;
      min-width: 0;
    }
    .task-name { font-weight: 700; font-size: 0.9rem; color: #1e293b; }
    .task-stage { font-size: 0.78rem; color: #64748b; margin-top: 2px; }
    .task-focus { font-size: 0.73rem; color: #94a3b8; margin-top: 2px; }
    .task-actions {
      order: 1;
      display: flex; flex-direction: column;
      justify-content: center; gap: 4px;
      padding: 0.5rem 0.25rem 0.5rem 0;
      flex-shrink: 0;
    }
    .task-btn {
      width: 30px; height: 30px; border-radius: 50%;
      border: 2px solid #e2e8f0; background: #fff;
      font-size: 0.85rem; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.15s;
    }
    .task-btn:hover { transform: scale(1.1); }
    .done-btn:hover, .done-btn.active {
      background: #d1fae5; border-color: #10b981; color: #065f46;
    }
    .miss-btn:hover, .miss-btn.active {
      background: #fee2e2; border-color: #ef4444; color: #991b1b;
    }
    .task-future-note {
      font-size: 0.7rem; color: #94a3b8;
      background: #f1f5f9; padding: 2px 6px; border-radius: 4px;
    }
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
})();


