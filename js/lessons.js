// lessons.js - draws the lesson list and the Markdown lesson viewer.
//
// Page addresses used by the site:
//   .../                      -> the lesson list
//   .../#/lesson/<lesson id>  -> a Markdown lesson (the id is URL-encoded)
// PDFs are opened directly in a new tab, so they have no page address of their own.

import {
  CatalogueError,
  buildTree,
  fetchCatalogue,
  fetchText,
  resolveRepoUrl,
} from "./catalogue.js";
import { inlineToText, parseMarkdown, renderBlocks } from "./markdown.js";

const LESSON_HASH = "#/lesson/";

const ui = {
  catalogueView: document.getElementById("catalogue-view"),
  status: document.getElementById("status"),
  list: document.getElementById("catalogue"),
  lessonView: document.getElementById("lesson-view"),
  lessonTitle: document.getElementById("lesson-title"),
  lessonStatus: document.getElementById("lesson-status"),
  lessonContent: document.getElementById("lesson-content"),
};

let catalogue = null; // { lessons, categories, skipped } once loaded
let lessonLinks = new Map(); // address of a Markdown lesson file -> lesson id
let navigation = 0; // lets us ignore a slow lesson if the reader has moved on

// ---------------------------------------------------------------------------
// Small helpers (everything uses textContent, never innerHTML)
// ---------------------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

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

// ---------------------------------------------------------------------------
// Markdown lesson viewer
// ---------------------------------------------------------------------------

// A link inside a lesson that points at another Markdown lesson becomes an
// in-site link instead of opening the raw .md file.
function linkResolver(url) {
  const id = lessonLinks.get(url.origin + url.pathname);
  return id ? LESSON_HASH + encodeURIComponent(id) : null;
}

async function openLesson(lessonId) {
  const mine = ++navigation;
  const lesson = catalogue && catalogue.lessons.find((l) => l.id === lessonId && l.type === "markdown");

  ui.catalogueView.hidden = true;
  ui.lessonView.hidden = false;
  ui.lessonContent.replaceChildren();

  if (!lesson) {
    ui.lessonTitle.textContent = "Lesson not found";
    document.title = "Lesson not found | संस्कृत-मित्रम्";
    showMessage(ui.lessonStatus, "This lesson is not in the catalogue. It may have been moved or removed.", {
      kind: "error",
    });
    return;
  }

  ui.lessonTitle.textContent = lesson.title;
  document.title = lesson.title + " | संस्कृत-मित्रम्";
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
  ui.lessonContent.append(
    renderBlocks(blocks, {
      baseUrl: resolveRepoUrl(lesson.path),
      linkResolver,
      headingOffset: 2, // the lesson title is an h2, so Markdown "#" becomes h3
    }),
  );
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function currentLessonId() {
  const hash = window.location.hash;
  if (!hash.startsWith(LESSON_HASH)) return null;
  try {
    return decodeURIComponent(hash.slice(LESSON_HASH.length));
  } catch {
    return ""; // a broken %-sequence: shown as "Lesson not found"
  }
}

function route() {
  const lessonId = currentLessonId();
  if (lessonId === null || catalogue === null) {
    navigation++;
    ui.lessonView.hidden = true;
    ui.catalogueView.hidden = false;
    document.title = "संस्कृत-मित्रम् | Sanskrit-Mitram";
    return;
  }
  openLesson(lessonId);
}

async function init() {
  await loadCatalogue();
  route();
}

window.addEventListener("hashchange", route);
init();
