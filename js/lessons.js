// lessons.js - draws the lesson list, the Markdown lesson viewer and the Quiz
// History pages, and decides which one to show.
//
// Page addresses (the part after "#" never reaches the server, so this works
// on GitHub Pages project sites such as https://username.github.io/repository/):
//   #/                      the lesson list
//   #/lesson/<lesson id>    a Markdown lesson (the id is URL-encoded)
//   #/history               Quiz History
//   #/history/<attempt id>  one saved quiz attempt
// PDFs open directly in a new tab, so they have no page address of their own.

import { CatalogueError, buildTree, fetchCatalogue, fetchText, resolveRepoUrl } from "./catalogue.js";
import { el } from "./dom.js";
import { HISTORY_TITLE_SA, renderAttemptPage, renderHistoryPage } from "./history.js";
import { inlineToText, parseMarkdown, renderBlocks } from "./markdown.js";
import { renderQuizBlock } from "./quiz-ui.js";
import { getAttempt } from "./quiz-store.js";

const LESSON_HASH = "#/lesson/";
const HISTORY_HASH = "#/history";
const SITE_NAME = "संस्कृत-मित्रम्";

const ui = {
  catalogueView: document.getElementById("catalogue-view"),
  status: document.getElementById("status"),
  list: document.getElementById("catalogue"),
  lessonView: document.getElementById("lesson-view"),
  lessonTitle: document.getElementById("lesson-title"),
  lessonStatus: document.getElementById("lesson-status"),
  lessonContent: document.getElementById("lesson-content"),
  historyView: document.getElementById("history-view"),
  historyContent: document.getElementById("history-content"),
  navLessons: document.getElementById("nav-lessons"),
  navHistory: document.getElementById("nav-history"),
};

let catalogue = null; // { lessons, categories, skipped } once loaded
let lessonLinks = new Map(); // address of a Markdown lesson file -> lesson id
let navigation = 0; // lets us ignore a slow lesson if the reader has moved on

// ---------------------------------------------------------------------------
// Small helpers (everything uses textContent, never innerHTML)
// ---------------------------------------------------------------------------

function showMessage(target, message, { kind = "info", retry = null } = {}) {
  target.replaceChildren();
  target.dataset.kind = kind;
  if (message === null) {
    target.hidden = true;
    return;
  }
  target.hidden = false;
  target.append(el("p", "", message));
  if (retry) {
    const button = el("button", "retry-button", "Try again");
    button.type = "button";
    button.addEventListener("click", retry);
    target.append(button);
  }
}

function explain(error) {
  return error instanceof CatalogueError ? error.message : "Something went wrong while loading.";
}

// ---------------------------------------------------------------------------
// Lesson list
// ---------------------------------------------------------------------------

function lessonHref(lesson) {
  return lesson.type === "pdf" ? resolveRepoUrl(lesson.path) : LESSON_HASH + encodeURIComponent(lesson.id);
}

function renderLesson(lesson) {
  const item = el("li", "lesson");
  const link = el("a", "lesson-link", lesson.title);
  link.href = lessonHref(lesson);
  if (lesson.type === "pdf") {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  const badge = el("span", "badge badge-" + lesson.type, lesson.type === "pdf" ? "PDF" : "Lesson");
  item.append(link, badge);
  if (lesson.type === "pdf") item.append(el("span", "visually-hidden", " (opens in a new tab)"));
  if (lesson.keywords.length > 0) item.append(el("span", "keywords", lesson.keywords.join(", ")));
  return item;
}

function renderNode(node, depth) {
  const section = el("section", "group group-" + Math.min(depth, 3));
  section.append(el("h" + Math.min(depth + 2, 6), "group-title", node.label));
  if (node.lessons.length > 0) {
    const list = el("ul", "lesson-list");
    node.lessons.forEach((lesson) => list.append(renderLesson(lesson)));
    section.append(list);
  }
  node.children.forEach((child) => section.append(renderNode(child, depth + 1)));
  return section;
}

function renderCatalogue() {
  ui.list.replaceChildren();
  if (catalogue.lessons.length === 0) {
    showMessage(ui.status, "No lessons yet. Add a .md or .pdf file to a content folder and it will appear here.", {
      kind: "empty",
    });
    return;
  }
  const notice =
    catalogue.skipped > 0
      ? `${catalogue.skipped} entr${catalogue.skipped === 1 ? "y was" : "ies were"} skipped because the data was not valid.`
      : null;
  showMessage(ui.status, notice, { kind: "warning" });
  buildTree(catalogue.lessons, catalogue.categories).forEach((node) => ui.list.append(renderNode(node, 0)));
}

async function loadCatalogue() {
  showMessage(ui.status, "Loading lessons…", { kind: "loading" });
  ui.list.replaceChildren();
  try {
    catalogue = await fetchCatalogue();
  } catch (error) {
    catalogue = null;
    showMessage(ui.status, "Could not load the lessons. " + explain(error), { kind: "error", retry: init });
    return;
  }
  lessonLinks = new Map(
    catalogue.lessons
      .filter((lesson) => lesson.type === "markdown")
      .map((lesson) => {
        const url = new URL(resolveRepoUrl(lesson.path));
        return [url.origin + url.pathname, lesson.id];
      }),
  );
  renderCatalogue();
}

function findMarkdownLesson(lessonId) {
  return catalogue ? catalogue.lessons.find((l) => l.id === lessonId && l.type === "markdown") || null : null;
}

// ---------------------------------------------------------------------------
// Markdown lesson viewer
// ---------------------------------------------------------------------------

// A link inside a lesson that points at another Markdown lesson becomes an
// in-site link instead of opening the raw .md file.
function linkResolver(url) {
  const id = lessonLinks.get(url.origin + url.pathname);
  return id ? LESSON_HASH + encodeURIComponent(id) : null;
}

// What a saved quiz attempt remembers about the lesson it came from.
function lessonInfo(lesson) {
  return {
    id: lesson.id,
    title: lesson.title,
    category: lesson.category,
    categoryLabel: lesson.sectionLabels[0],
    sectionLabels: lesson.sectionLabels,
  };
}

function backToLessonTop() {
  window.scrollTo(0, 0);
  ui.lessonTitle.focus();
}

async function openLesson(lessonId) {
  const mine = ++navigation;
  const lesson = findMarkdownLesson(lessonId);

  ui.lessonContent.replaceChildren();

  if (!lesson) {
    ui.lessonTitle.textContent = "Lesson not found";
    document.title = `Lesson not found | ${SITE_NAME}`;
    showMessage(ui.lessonStatus, "This lesson is not in the catalogue. It may have been moved or removed.", {
      kind: "error",
    });
    return;
  }

  ui.lessonTitle.textContent = lesson.title;
  document.title = `${lesson.title} | ${SITE_NAME}`;
  showMessage(ui.lessonStatus, "Loading lesson…", { kind: "loading" });
  window.scrollTo(0, 0);
  ui.lessonTitle.focus();

  let text;
  try {
    text = await fetchText(resolveRepoUrl(lesson.path));
  } catch (error) {
    if (mine !== navigation) return;
    showMessage(ui.lessonStatus, "Could not load this lesson. " + explain(error), {
      kind: "error",
      retry: () => openLesson(lessonId),
    });
    return;
  }
  if (mine !== navigation) return; // the reader already went somewhere else

  const blocks = parseMarkdown(text);
  // The page already shows the title, so drop a first heading that repeats it.
  if (blocks[0] && blocks[0].type === "heading" && inlineToText(blocks[0].children) === lesson.title) {
    blocks.shift();
  }
  if (blocks.length === 0) {
    showMessage(ui.lessonStatus, "This lesson is empty.", { kind: "empty" });
    return;
  }
  showMessage(ui.lessonStatus, null);

  // Shared by every quiz in this lesson (see quiz-ui.js).
  const quizContext = {
    lesson: lessonInfo(lesson),
    seenQuizIds: new Set(),
    onBackToLesson: backToLessonTop,
  };
  ui.lessonContent.append(
    renderBlocks(blocks, {
      baseUrl: resolveRepoUrl(lesson.path),
      linkResolver,
      headingOffset: 2, // the lesson title is an h2, so Markdown "#" becomes h3
      renderQuiz: (jsonText) => renderQuizBlock(jsonText, quizContext),
    }),
  );
}

// ---------------------------------------------------------------------------
// Quiz History pages
// ---------------------------------------------------------------------------

function showHistoryRoute(route) {
  if (route.name === "history") {
    renderHistoryPage(ui.historyContent);
    document.title = `${HISTORY_TITLE_SA} | ${SITE_NAME}`;
  } else {
    // The "Back to Lesson" link only appears if the lesson still exists.
    const attempt = getAttempt(route.id);
    const lesson = attempt && attempt.lesson ? findMarkdownLesson(attempt.lesson.id) : null;
    renderAttemptPage(ui.historyContent, route.id, {
      lessonHref: lesson ? LESSON_HASH + encodeURIComponent(lesson.id) : null,
    });
    document.title = `Saved quiz attempt | ${SITE_NAME}`;
  }
  window.scrollTo(0, 0);
  // Move focus to the page heading so keyboard and screen-reader users know the page changed.
  const heading = [...ui.historyContent.children].find((node) => node.tagName === "H2");
  if (heading) heading.focus();
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return ""; // a broken %-sequence: shown as "not found"
  }
}

function parseRoute() {
  const hash = window.location.hash;
  if (hash === HISTORY_HASH || hash === HISTORY_HASH + "/") return { name: "history" };
  if (hash.startsWith(HISTORY_HASH + "/")) return { name: "attempt", id: safeDecode(hash.slice(HISTORY_HASH.length + 1)) };
  if (hash.startsWith(LESSON_HASH)) return { name: "lesson", id: safeDecode(hash.slice(LESSON_HASH.length)) };
  return { name: "home" };
}

function showView(view) {
  ui.catalogueView.hidden = view !== "home";
  ui.lessonView.hidden = view !== "lesson";
  ui.historyView.hidden = view !== "history";
  // aria-current tells screen readers (and the CSS) which menu item is the current page.
  const current = (node, active) => (active ? node.setAttribute("aria-current", "page") : node.removeAttribute("aria-current"));
  current(ui.navLessons, view !== "history");
  current(ui.navHistory, view === "history");
}

function route() {
  const target = parseRoute();
  navigation++; // cancels any lesson that is still loading

  if (target.name === "history" || target.name === "attempt") {
    showView("history");
    showHistoryRoute(target);
    return;
  }
  if (target.name === "lesson" && catalogue !== null) {
    showView("lesson");
    openLesson(target.id);
    return;
  }
  showView("home");
  document.title = `${SITE_NAME} | Sanskrit-Mitram`;
}

async function init() {
  const first = parseRoute().name;
  // History pages do not need the lesson catalogue, so show them straight away.
  if (first === "history" || first === "attempt") route();
  await loadCatalogue();
  route(); // draw again: "Back to Lesson" links need the catalogue
}

window.addEventListener("hashchange", route);
init();
