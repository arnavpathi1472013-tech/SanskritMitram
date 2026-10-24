// quiz-core.js - the rules of the quiz system, with NO page (DOM) code.
// Because it only works on plain data, it is easy to test.
//
//   parseQuiz(text)            check a quiz written in a lesson
//   scoreQuiz(quiz, answers)   work out score and per-question status
//   createAttempt(...)         build the record saved to history
//   validateAttempt(raw)       re-check a saved record when reading it back

export const SCHEMA_VERSION = 1; // format of a SAVED attempt
export const SUPPORTED_QUIZ_VERSION = 1; // format of the quiz JSON in a lesson
export const QUIZ_LANGUAGE = "quiz-json"; // the fenced-code-block name in Markdown

export const STATUS = Object.freeze({
  CORRECT: "correct",
  WRONG: "wrong",
  UNATTEMPTED: "unattempted",
});

const ID_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,99}$/u;
const MAX_QUESTIONS = 200;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;
const MAX_TEXT = 2000;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isId = (value) => typeof value === "string" && ID_PATTERN.test(value);
const isText = (value) => typeof value === "string" && value.trim() !== "" && value.length <= MAX_TEXT;
const ID_HELP = 'Use letters, digits, ".", "_" or "-" (up to 100 characters, starting with a letter or digit).';

// ---------------------------------------------------------------------------
// Reading a quiz from a lesson
// ---------------------------------------------------------------------------

// Returns { ok: true, quiz } or { ok: false, errors: [text, ...] }.
export function parseQuiz(rawText) {
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (error) {
    return { ok: false, errors: ["The quiz is not valid JSON: " + error.message] };
  }
  return validateQuiz(data);
}

export function validateQuiz(data) {
  if (!isObject(data)) return { ok: false, errors: ["The quiz must be a JSON object, written with { }."] };

  const errors = [];
  if (!isId(data.id)) errors.push('"id" is missing or not valid. ' + ID_HELP);
  if (!isText(data.title)) errors.push('"title" is missing or empty.');

  let version = 1;
  if (data.version !== undefined) {
    if (!Number.isInteger(data.version) || data.version < 1) errors.push('"version" must be a whole number such as 1.');
    else if (data.version > SUPPORTED_QUIZ_VERSION) errors.push(`"version" ${data.version} is newer than this site understands.`);
    else version = data.version;
  }

  const questions = [];
  if (!Array.isArray(data.questions) || data.questions.length === 0) {
    errors.push('"questions" must be a list with at least one question.');
  } else if (data.questions.length > MAX_QUESTIONS) {
    errors.push(`A quiz can have at most ${MAX_QUESTIONS} questions.`);
  } else {
    const seenQuestionIds = new Set();
    data.questions.forEach((raw, index) => {
      const question = validateQuestion(raw, index + 1, seenQuestionIds, errors);
      if (question) questions.push(question);
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    quiz: { id: data.id, title: data.title.trim(), version, questions },
  };
}

function validateQuestion(raw, number, seenIds, errors) {
  const where = `Question ${number}`;
  if (!isObject(raw)) {
    errors.push(`${where} must be an object.`);
    return null;
  }
  let valid = true;
  const problem = (message) => {
    errors.push(`${where}: ${message}`);
    valid = false;
  };

  if (!isId(raw.id)) problem('"id" is missing or not valid. ' + ID_HELP);
  else if (seenIds.has(raw.id)) problem(`the id "${raw.id}" is used by another question. Question ids must be unique.`);
  else seenIds.add(raw.id);

  if (raw.type !== "single_select") {
    problem(`type ${JSON.stringify(raw.type)} is not supported. Use "single_select".`);
  }
  if (!isText(raw.question)) problem('"question" is missing or empty.');

  const options = [];
  if (!Array.isArray(raw.options) || raw.options.length < MIN_OPTIONS || raw.options.length > MAX_OPTIONS) {
    problem(`"options" must be a list of ${MIN_OPTIONS} to ${MAX_OPTIONS} options.`);
  } else {
    const seenOptionIds = new Set();
    raw.options.forEach((option, optionIndex) => {
      const label = `option ${optionIndex + 1}`;
      if (!isObject(option)) return problem(`${label} must be an object.`);
      if (!isId(option.id)) problem(`${label} has a missing or invalid "id".`);
      else if (seenOptionIds.has(option.id)) problem(`${label} repeats the option id "${option.id}".`);
      else seenOptionIds.add(option.id);
      if (!isText(option.text)) problem(`${label} has missing or empty "text".`);
      if (isId(option.id) && isText(option.text)) options.push({ id: option.id, text: option.text.trim() });
    });
  }

  if (Array.isArray(raw.correctAnswer)) {
    problem('"correctAnswer" must be ONE option id (a string), not a list.');
  } else if (typeof raw.correctAnswer !== "string") {
    problem('"correctAnswer" is missing. Give the id of the correct option.');
  } else if (!options.some((option) => option.id === raw.correctAnswer)) {
    problem(`"correctAnswer" ("${raw.correctAnswer}") does not match any option id.`);
  }

  let explanation = "";
  if (raw.explanation !== undefined) {
    if (typeof raw.explanation !== "string" || raw.explanation.length > MAX_TEXT) problem('"explanation" must be text.');
    else explanation = raw.explanation.trim();
  }

  if (!valid) return null;
  return { id: raw.id, type: "single_select", question: raw.question.trim(), options, correctAnswer: raw.correctAnswer, explanation };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function percentOf(score, total) {
  return total > 0 ? Math.round((100 * score) / total) : 0;
}

// answers: { questionId: optionId }. A missing answer is "unattempted".
// One point for each correct answer; wrong and unattempted both score 0.
export function scoreQuiz(quiz, answers) {
  const results = quiz.questions.map((question) => {
    const picked = answers && Object.prototype.hasOwnProperty.call(answers, question.id) ? answers[question.id] : null;
    const selected = question.options.some((option) => option.id === picked) ? picked : null;
    let status = STATUS.UNATTEMPTED;
    if (selected !== null) status = selected === question.correctAnswer ? STATUS.CORRECT : STATUS.WRONG;
    return {
      id: question.id,
      question: question.question,
      options: question.options.map((option) => ({ id: option.id, text: option.text })),
      selected,
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
      status,
    };
  });
  return { questions: results, ...tally(results) };
}

function tally(results) {
  const correct = results.filter((r) => r.status === STATUS.CORRECT).length;
  const wrong = results.filter((r) => r.status === STATUS.WRONG).length;
  const unattempted = results.filter((r) => r.status === STATUS.UNATTEMPTED).length;
  const total = results.length;
  return { score: correct, total, correct, wrong, unattempted, percent: percentOf(correct, total) };
}

export function performanceMessage(percent) {
  if (percent >= 90) return "Excellent work!";
  if (percent >= 70) return "Good work!";
  if (percent >= 50) return "Getting there. Read the lesson once more and try again.";
  return "Keep practising. Review the lesson and try again.";
}

// Numbers for the circular score ring, so the picture always matches the score.
export function ringGeometry(score, total, radius = 52) {
  const circumference = 2 * Math.PI * radius;
  const fraction = total > 0 ? Math.min(1, Math.max(0, score / total)) : 0;
  return { circumference, fraction, offset: circumference * (1 - fraction), percent: percentOf(score, total) };
}

// ---------------------------------------------------------------------------
// Attempt records (what is saved in history)
// ---------------------------------------------------------------------------

export function newAttemptId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// lesson: { id, title, category, categoryLabel, sectionLabels } or null.
// The record keeps a full copy of every question, option, answer key and
// explanation, so it still reads correctly if the lesson is edited later.
export function createAttempt(quiz, answers, lesson = null, now = new Date(), attemptId = newAttemptId()) {
  const scored = scoreQuiz(quiz, answers);
  return {
    schemaVersion: SCHEMA_VERSION,
    attemptId,
    quizId: quiz.id,
    quizVersion: quiz.version,
    quizTitle: quiz.title,
    lesson: lesson
      ? {
          id: lesson.id,
          title: lesson.title,
          category: lesson.category || "",
          categoryLabel: lesson.categoryLabel || "",
          sectionLabels: Array.isArray(lesson.sectionLabels) ? lesson.sectionLabels.slice() : [],
        }
      : null,
    submittedAt: now.toISOString(),
    score: scored.score,
    total: scored.total,
    percent: scored.percent,
    correct: scored.correct,
    wrong: scored.wrong,
    unattempted: scored.unattempted,
    questions: scored.questions,
  };
}

const STATUS_VALUES = new Set(Object.values(STATUS));
const isString = (value) => typeof value === "string";

// Checks a record read from storage. Returns a clean copy, or null if the
// record is damaged or inconsistent (so it can be skipped, not crash the page).
export function validateAttempt(raw) {
  try {
    if (!isObject(raw) || raw.schemaVersion !== SCHEMA_VERSION) return null;
    if (![raw.attemptId, raw.quizId, raw.quizTitle, raw.submittedAt].every((v) => isString(v) && v !== "")) return null;
    if (!Array.isArray(raw.questions) || raw.questions.length === 0) return null;

    const questions = [];
    for (const q of raw.questions) {
      if (!isObject(q) || !isString(q.id) || !isString(q.question) || !isString(q.correctAnswer)) return null;
      if (!Array.isArray(q.options) || q.options.length < 2) return null;
      if (!q.options.every((o) => isObject(o) && isString(o.id) && isString(o.text))) return null;
      const ids = q.options.map((o) => o.id);
      if (new Set(ids).size !== ids.length || !ids.includes(q.correctAnswer)) return null;
      if (q.selected !== null && !ids.includes(q.selected)) return null;

      // The status must agree with the selection; never trust it blindly.
      const expected = q.selected === null ? STATUS.UNATTEMPTED : q.selected === q.correctAnswer ? STATUS.CORRECT : STATUS.WRONG;
      if (!STATUS_VALUES.has(q.status) || q.status !== expected) return null;

      questions.push({
        id: q.id,
        question: q.question,
        options: q.options.map((o) => ({ id: o.id, text: o.text })),
        selected: q.selected,
        correctAnswer: q.correctAnswer,
        explanation: isString(q.explanation) ? q.explanation : "",
        status: q.status,
      });
    }

    const counts = tally(questions);
    const stored = [raw.score, raw.total, raw.correct, raw.wrong, raw.unattempted, raw.percent];
    const recomputed = [counts.score, counts.total, counts.correct, counts.wrong, counts.unattempted, counts.percent];
    if (stored.some((value, i) => value !== recomputed[i])) return null;

    let lesson = null;
    if (isObject(raw.lesson) && isString(raw.lesson.id) && isString(raw.lesson.title)) {
      lesson = {
        id: raw.lesson.id,
        title: raw.lesson.title,
        category: isString(raw.lesson.category) ? raw.lesson.category : "",
        categoryLabel: isString(raw.lesson.categoryLabel) ? raw.lesson.categoryLabel : "",
        sectionLabels: Array.isArray(raw.lesson.sectionLabels) ? raw.lesson.sectionLabels.filter(isString) : [],
      };
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      attemptId: raw.attemptId,
      quizId: raw.quizId,
      quizVersion: Number.isInteger(raw.quizVersion) ? raw.quizVersion : 1,
      quizTitle: raw.quizTitle,
      lesson,
      submittedAt: raw.submittedAt,
      ...counts,
      questions,
    };
  } catch {
    return null;
  }
}
