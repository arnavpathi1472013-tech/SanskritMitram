// history.js - the Quiz History page (मम प्रश्नोत्तरी-इतिहासः) and the view of
// one saved attempt. Reads saved attempts through quiz-store.js.

import { button, el, link } from "./dom.js";
import { STATUS } from "./quiz-core.js";
import { clearHistory, loadAttempts } from "./quiz-store.js";
import { formatDate, HISTORY_HASH, renderResult } from "./quiz-ui.js";

export const HISTORY_TITLE_SA = "मम प्रश्नोत्तरी-इतिहासः";
export const HISTORY_TITLE_EN = "Quiz History";

const STORAGE_NOTE =
  "Your history is saved in this browser only. It does not sync to other browsers or devices, and clearing your browser's site data removes it.";

function pageHeading() {
  const heading = el("h2", "history-title");
  heading.tabIndex = -1;
  const sanskrit = el("span", "", HISTORY_TITLE_SA);
  sanskrit.lang = "sa";
  heading.append(sanskrit, document.createTextNode(" "), el("span", "history-title-en", `(${HISTORY_TITLE_EN})`));
  return heading;
}

function categoryOf(attempt) {
  return attempt.lesson && attempt.lesson.categoryLabel ? attempt.lesson.categoryLabel : "Other";
}

// ---------------------------------------------------------------------------
// The list of all attempts
// ---------------------------------------------------------------------------

// options.message: optional text announced after a change (e.g. "History cleared.")
export function renderHistoryPage(container, options = {}) {
  container.replaceChildren(pageHeading());

  if (options.message) {
    const message = el("p", "message history-message", options.message);
    message.setAttribute("role", "status");
    container.append(message);
  }

  const { available, attempts, skipped } = loadAttempts();

  if (!available) {
    const problem = el("div", "message");
    problem.dataset.kind = "error";
    problem.setAttribute("role", "alert");
    problem.append(
      el(
        "p",
        "",
        "Quiz history is not available because this browser is blocking local storage (private browsing and some privacy settings do this). Quizzes still work, but their results cannot be saved.",
      ),
    );
    container.append(problem);
    return;
  }

  if (skipped > 0) {
    const warning = el(
      "p",
      "message",
      `${skipped} saved entr${skipped === 1 ? "y was" : "ies were"} damaged and could not be shown. Other attempts are not affected.`,
    );
    warning.dataset.kind = "warning";
    container.append(warning);
  }

  if (attempts.length === 0) {
    const empty = el("div", "message history-empty");
    empty.dataset.kind = "empty";
    empty.append(
      el("p", "", "No quiz attempts yet."),
      el("p", "", "When you finish a quiz in a lesson, your result will appear here so you can review it later."),
      link("Browse lessons", "#/", "button"),
    );
    container.append(empty, el("p", "history-note", STORAGE_NOTE));
    return;
  }

  buildList(container, attempts);
}

function buildList(container, attempts) {
  const categories = [...new Set(attempts.map(categoryOf))].sort((a, b) => a.localeCompare(b));

  const summary = el("p", "history-summary");
  summary.setAttribute("role", "status");

  const list = el("ul", "history-list");

  const filterRow = el("div", "history-filter");
  const select = el("select", "history-select");
  select.id = "history-category";
  const addOption = (label, value) => {
    const option = el("option", "", label);
    option.value = value;
    select.append(option);
  };
  addOption("All categories", "");
  categories.forEach((name) => addOption(name, name));
  const selectLabel = el("label", "", "Show category: ");
  selectLabel.htmlFor = select.id;
  filterRow.append(selectLabel, select);
  if (categories.length < 2) filterRow.hidden = true; // a filter is pointless with one category

  function draw() {
    const shown = select.value ? attempts.filter((a) => categoryOf(a) === select.value) : attempts;
    const quizzes = new Set(shown.map((a) => a.quizId)).size;
    const average = shown.length ? Math.round(shown.reduce((sum, a) => sum + a.percent, 0) / shown.length) : 0;
    summary.textContent =
      `${shown.length} attempt${shown.length === 1 ? "" : "s"} · ${quizzes} quiz${quizzes === 1 ? "" : "zes"} · average score ${average}%`;
    list.replaceChildren(...shown.map(renderEntry));
  }
  select.addEventListener("change", draw);

  container.append(summary, filterRow, list);
  draw();

  container.append(el("p", "history-note", STORAGE_NOTE), buildClearControl(container, attempts.length));
}

function renderEntry(attempt) {
  const item = el("li", "history-entry");

  const top = el("div", "entry-top");
  top.append(el("h3", "entry-title", attempt.quizTitle));
  top.append(el("p", "entry-score", `${attempt.score}/${attempt.total} · ${attempt.percent}%`));
  item.append(top);

  const meta = el("p", "entry-meta");
  if (attempt.lesson) meta.append(document.createTextNode(`${attempt.lesson.title} · ${categoryOf(attempt)} · `));
  const time = el("time", "", formatDate(attempt.submittedAt));
  time.dateTime = attempt.submittedAt;
  meta.append(time);
  item.append(meta);

  const counts = el("ul", "result-counts entry-counts");
  [
    [STATUS.CORRECT, "✓", attempt.correct, "correct"],
    [STATUS.WRONG, "✗", attempt.wrong, "wrong"],
    [STATUS.UNATTEMPTED, "—", attempt.unattempted, "unattempted"],
  ].forEach(([status, icon, count, label]) => {
    const li = el("li", "count count-" + status);
    const mark = el("span", "status-icon", icon);
    mark.setAttribute("aria-hidden", "true");
    li.append(mark, document.createTextNode(` ${count} ${label}`));
    counts.append(li);
  });
  item.append(counts);

  const view = link("View attempt", `${HISTORY_HASH}/${encodeURIComponent(attempt.attemptId)}`, "button");
  view.setAttribute("aria-label", `View attempt: ${attempt.quizTitle}, ${attempt.score} out of ${attempt.total}, ${formatDate(attempt.submittedAt)}`);
  item.append(view);
  return item;
}

function buildClearControl(container, count) {
  const area = el("div", "history-clear");
  const clearButton = button("Clear history", "button button-danger", () => {
    area.replaceChildren();
    area.setAttribute("role", "alert");
    area.append(
      el("p", "quiz-confirm-title", `Delete all ${count} saved attempt${count === 1 ? "" : "s"}?`),
      el("p", "", "This cannot be undone."),
    );
    const row = el("div", "button-row");
    const cancel = button("Cancel", "button", () => {
      area.removeAttribute("role");
      area.replaceChildren(clearButton);
      clearButton.focus();
    });
    const confirm = button("Yes, delete everything", "button button-danger", () => {
      const result = clearHistory();
      renderHistoryPage(container, {
        message: result.ok ? "Your quiz history has been cleared." : "History could not be cleared because browser storage is blocked.",
      });
      const heading = container.firstChild;
      if (heading) heading.focus();
    });
    row.append(cancel, confirm);
    area.append(row);
    cancel.focus(); // the safe choice is focused first
  });
  area.append(clearButton);
  return area;
}

// ---------------------------------------------------------------------------
// One saved attempt
// ---------------------------------------------------------------------------

// options.lessonHref: address of the lesson page, or null if the lesson is gone
export function renderAttemptPage(container, attemptId, options = {}) {
  container.replaceChildren();
  const { available, attempts } = loadAttempts();
  const attempt = available ? attempts.find((a) => a.attemptId === attemptId) : null;

  const back = link("← Back to Quiz History", HISTORY_HASH, "back-link");

  if (!attempt) {
    const heading = el("h2", "history-title", "Attempt not found");
    heading.tabIndex = -1;
    const message = el(
      "p",
      "",
      available
        ? "This attempt is not in your history. It may have been cleared, or it was saved in a different browser."
        : "Quiz history is not available because this browser is blocking local storage.",
    );
    const box = el("div", "message");
    box.dataset.kind = "error";
    box.append(message);
    container.append(back, heading, box);
    return;
  }

  const heading = el("h2", "history-title", "Saved attempt");
  heading.tabIndex = -1;
  const meta = el("p", "entry-meta");
  if (attempt.lesson) meta.append(document.createTextNode(`${attempt.lesson.title} · ${categoryOf(attempt)} · `));
  const time = el("time", "", formatDate(attempt.submittedAt));
  time.dateTime = attempt.submittedAt;
  meta.append(time);

  const actions = [{ label: "View Quiz History", href: HISTORY_HASH }];
  if (options.lessonHref) {
    actions.unshift({ label: "Retry Quiz", href: options.lessonHref });
    actions.unshift({ label: "Back to Lesson", href: options.lessonHref });
  }

  container.append(
    back,
    heading,
    meta,
    el("p", "history-note", "This is the saved copy of your attempt. It stays the same even if the lesson is edited later."),
    renderResult(attempt, { actions, animate: true }),
  );
}
