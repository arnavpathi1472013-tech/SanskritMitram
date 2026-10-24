// quiz-ui.js - draws quizzes, the circular score ring and the question review.
// All text is placed with textContent (never innerHTML), so quiz content can
// never run as code.

import { button, el, link, svgEl } from "./dom.js";
import { createAttempt, parseQuiz, performanceMessage, ringGeometry, STATUS } from "./quiz-core.js";
import { latestAttemptFor, saveAttempt } from "./quiz-store.js";

export const HISTORY_HASH = "#/history";

const STATUS_INFO = {
  [STATUS.CORRECT]: { icon: "✓", label: "Correct" },
  [STATUS.WRONG]: { icon: "✗", label: "Wrong" },
  [STATUS.UNATTEMPTED]: { icon: "—", label: "Unattempted" },
};

let instanceCount = 0; // keeps radio-button group names unique per quiz on a page

export function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------------------
// Entry point used by the Markdown reader
// ---------------------------------------------------------------------------
//
// context = {
//   lesson:        { id, title, category, categoryLabel, sectionLabels } | null
//   seenQuizIds:   Set, shared by all quizzes on one lesson page
//   onBackToLesson function() called by the "Back to Lesson" button
// }

export function renderQuizBlock(rawText, context = {}) {
  const parsed = parseQuiz(rawText);
  if (!parsed.ok) return renderQuizError(parsed.errors);

  const seen = context.seenQuizIds;
  if (seen) {
    if (seen.has(parsed.quiz.id)) {
      return renderQuizError([`Another quiz on this page already uses the id "${parsed.quiz.id}". Give each quiz its own id.`]);
    }
    seen.add(parsed.quiz.id);
  }
  return mountQuiz(parsed.quiz, context);
}

function renderQuizError(errors) {
  const box = el("section", "quiz-error");
  box.setAttribute("role", "alert");
  box.append(el("h3", "quiz-error-title", "This quiz could not be shown"));
  box.append(el("p", "", "The rest of the lesson is not affected. The author needs to fix the quiz block:"));
  const list = el("ul", "quiz-error-list");
  errors.slice(0, 8).forEach((message) => list.append(el("li", "", message)));
  if (errors.length > 8) list.append(el("li", "", `…and ${errors.length - 8} more problem(s).`));
  box.append(list);
  return box;
}

// ---------------------------------------------------------------------------
// The interactive quiz
// ---------------------------------------------------------------------------

function mountQuiz(quiz, context) {
  const wrapper = el("div", "quiz-wrapper");

  const showQuiz = () => {
    wrapper.replaceChildren(buildQuiz(quiz, context, showResult));
  };

  const showResult = (attempt, saved) => {
    const actions = [
      { label: "Back to Lesson", onClick: context.onBackToLesson || (() => window.scrollTo(0, 0)) },
      { label: "Retry Quiz", onClick: showQuiz },
      { label: "View Quiz History", href: HISTORY_HASH },
    ];
    const note = saved.ok
      ? "Saved to your quiz history in this browser."
      : "This result could not be saved to your history (browser storage is blocked or full). It is shown here only.";
    const result = renderResult(attempt, { actions, animate: true, note, noteKind: saved.ok ? "info" : "warning" });
    wrapper.replaceChildren(result);
    result.firstChild.focus(); // the result heading, so screen readers announce the result
    result.scrollIntoView({ block: "start" });
  };

  showQuiz();
  return wrapper;
}

function buildQuiz(quiz, context, onSubmitted) {
  const instance = ++instanceCount;
  const answers = {}; // questionId -> optionId
  const total = quiz.questions.length;
  let submitted = false;

  const root = el("section", "quiz");
  root.setAttribute("aria-labelledby", `quiz-title-${instance}`);

  const title = el("h3", "quiz-title", quiz.title);
  title.id = `quiz-title-${instance}`;
  root.append(title);
  root.append(el("p", "quiz-intro", "Choose one answer for each question. You can change your answers until you submit."));

  const previous = latestAttemptFor(quiz.id);
  if (previous) {
    const line = el("p", "quiz-previous", `Your last attempt: ${previous.score}/${previous.total} on ${formatDate(previous.submittedAt)}. `);
    line.append(link("View Quiz History", HISTORY_HASH));
    root.append(line);
  }

  const progress = el("p", "quiz-progress");
  progress.setAttribute("role", "status");
  root.append(progress);

  const form = el("form", "quiz-form");
  form.noValidate = true;
  const radiosByQuestion = [];

  quiz.questions.forEach((question, index) => {
    const built = buildQuestion(question, index, total, instance, (optionId) => {
      answers[question.id] = optionId;
      updateProgress();
    });
    radiosByQuestion.push(built.radios);
    form.append(built.fieldset);
  });

  const confirmBox = el("div", "quiz-confirm");
  confirmBox.hidden = true;
  confirmBox.setAttribute("role", "alert");

  const submitButton = el("button", "button button-primary", "Submit Quiz");
  submitButton.type = "submit";
  form.append(confirmBox, submitButton);
  root.append(form);

  function unansweredNumbers() {
    return quiz.questions.map((q, i) => (answers[q.id] === undefined ? i + 1 : null)).filter((n) => n !== null);
  }

  function updateProgress() {
    const answered = total - unansweredNumbers().length;
    progress.textContent = `${answered} of ${total} answered · ${total - answered} remaining`;
  }

  function finish() {
    if (submitted) return; // guards against a double click saving twice
    submitted = true;
    submitButton.disabled = true;
    const attempt = createAttempt(quiz, answers, context.lesson || null);
    const saved = saveAttempt(attempt);
    onSubmitted(attempt, saved); // the form is replaced, so answers can no longer change
  }

  function askToConfirm(missing) {
    confirmBox.hidden = false;
    confirmBox.replaceChildren(
      el("p", "quiz-confirm-title", `You have ${missing.length} unanswered question${missing.length === 1 ? "" : "s"}.`),
      el("p", "", `Unanswered: ${missing.join(", ")}. Unanswered questions score 0 points.`),
    );
    const actions = el("div", "button-row");
    const back = button("Return to quiz", "button", () => {
      confirmBox.hidden = true;
      confirmBox.replaceChildren();
      const firstMissing = radiosByQuestion[missing[0] - 1][0];
      firstMissing.focus();
    });
    const confirm = button("Submit anyway", "button button-primary", finish);
    actions.append(back, confirm);
    confirmBox.append(actions);
    back.focus(); // the safe choice is focused first
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const missing = unansweredNumbers();
    if (missing.length > 0) askToConfirm(missing);
    else finish();
  });

  updateProgress();
  return root;
}

function buildQuestion(question, index, total, instance, onChange) {
  const fieldset = el("fieldset", "quiz-question");
  const legend = el("legend", "quiz-question-text");
  legend.append(el("span", "question-number", `Question ${index + 1} of ${total}`));
  legend.append(el("span", "question-body", question.question));
  fieldset.append(legend);

  const radios = [];
  const labels = [];
  const name = `quiz-${instance}-q${index}`;

  question.options.forEach((option) => {
    const label = el("label", "quiz-option");
    const input = el("input", "option-input");
    input.type = "radio";
    input.name = name;
    input.value = option.id;
    const mark = el("span", "option-mark");
    mark.setAttribute("aria-hidden", "true");
    label.append(input, mark, el("span", "option-text", option.text));
    input.addEventListener("change", () => {
      labels.forEach((l, i) => l.classList.toggle("is-selected", radios[i].checked));
      onChange(option.id);
    });
    radios.push(input);
    labels.push(label);
    fieldset.append(label);
  });
  return { fieldset, radios };
}

// ---------------------------------------------------------------------------
// Result: score ring + summary + review (also used by the history page)
// ---------------------------------------------------------------------------

// options: { actions: [{label, href | onClick}], animate, note, noteKind }
export function renderResult(attempt, options = {}) {
  const { actions = [], animate = false, note = null, noteKind = "info" } = options;
  const root = el("section", "quiz-result");

  const heading = el("h3", "result-title", `Result: ${attempt.quizTitle}`);
  heading.tabIndex = -1;
  root.append(heading);

  const summary = el("div", "result-summary");
  summary.append(renderRing(attempt.score, attempt.total, animate));

  const text = el("div", "result-text");
  text.append(el("p", "result-percent", `${attempt.percent}%`));
  text.append(el("p", "result-message", performanceMessage(attempt.percent)));
  text.append(
    el("p", "result-sentence", `${attempt.correct} out of ${attempt.total} correct. Unattempted questions score 0.`),
  );
  const counts = el("ul", "result-counts");
  [
    [STATUS.CORRECT, attempt.correct],
    [STATUS.WRONG, attempt.wrong],
    [STATUS.UNATTEMPTED, attempt.unattempted],
  ].forEach(([status, count]) => {
    const item = el("li", "count count-" + status);
    const icon = el("span", "status-icon", STATUS_INFO[status].icon);
    icon.setAttribute("aria-hidden", "true");
    item.append(icon, document.createTextNode(` ${count} ${STATUS_INFO[status].label.toLowerCase()}`));
    counts.append(item);
  });
  text.append(counts);
  summary.append(text);
  root.append(summary);

  if (note) {
    const noteEl = el("p", "result-note result-note-" + noteKind, note);
    if (noteKind === "warning") noteEl.setAttribute("role", "alert");
    root.append(noteEl);
  }

  if (actions.length > 0) {
    const row = el("div", "button-row");
    actions.forEach((action) => {
      row.append(action.href ? link(action.label, action.href, "button") : button(action.label, "button", action.onClick));
    });
    root.append(row);
  }

  root.append(el("h4", "review-heading", "Question review"));
  root.append(renderReview(attempt));
  return root;
}

export function renderRing(score, total, animate = false) {
  const geometry = ringGeometry(score, total);
  const wrap = el("div", "score-ring");
  wrap.setAttribute("role", "img");
  wrap.setAttribute("aria-label", `Score: ${score} out of ${total}, ${geometry.percent} percent`);
  wrap.dataset.score = String(score);
  wrap.dataset.total = String(total);
  wrap.dataset.percent = String(geometry.percent);

  const svg = svgEl("svg", { viewBox: "0 0 120 120", "aria-hidden": "true", focusable: "false" });
  svg.append(svgEl("circle", { class: "ring-track", cx: 60, cy: 60, r: 52, fill: "none", "stroke-width": 10 }));
  const progress = svgEl("circle", {
    class: "ring-progress",
    cx: 60,
    cy: 60,
    r: 52,
    fill: "none",
    "stroke-width": 10,
    "stroke-dasharray": geometry.circumference,
    transform: "rotate(-90 60 60)", // start at the top
  });
  wrap.dataset.dashoffset = String(geometry.offset);

  if (animate && !prefersReducedMotion()) {
    progress.style.strokeDashoffset = String(geometry.circumference); // start empty...
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        progress.style.strokeDashoffset = String(geometry.offset); // ...then grow to the score
      }),
    );
  } else {
    progress.style.strokeDashoffset = String(geometry.offset);
  }
  svg.append(progress);
  wrap.append(svg, el("span", "ring-fraction", `${score}/${total}`));
  return wrap;
}

export function renderReview(attempt) {
  const list = el("ol", "review-list");
  attempt.questions.forEach((q, index) => {
    const info = STATUS_INFO[q.status];
    const item = el("li", "review-item status-" + q.status);

    const head = el("div", "review-head");
    const badge = el("span", "status-badge status-badge-" + q.status);
    const icon = el("span", "status-icon", info.icon);
    icon.setAttribute("aria-hidden", "true");
    badge.append(icon, document.createTextNode(" " + info.label));
    head.append(el("span", "review-number", `Question ${index + 1}`), badge);
    item.append(head);
    item.append(el("p", "review-question", q.question));

    const textOf = (id) => (q.options.find((o) => o.id === id) || { text: "" }).text;
    const details = el("dl", "review-answers");

    details.append(el("dt", "", "Your answer"));
    if (q.status === STATUS.UNATTEMPTED) {
      details.append(el("dd", "answer-none", "No answer was submitted for this question."));
    } else {
      details.append(el("dd", q.status === STATUS.CORRECT ? "answer-right" : "answer-wrong", textOf(q.selected)));
    }
    details.append(el("dt", "", "Correct answer"));
    details.append(el("dd", "answer-right", textOf(q.correctAnswer)));
    if (q.explanation) {
      details.append(el("dt", "", "Explanation"));
      details.append(el("dd", "answer-explanation", q.explanation));
    }
    item.append(details);
    list.append(item);
  });
  return list;
}
