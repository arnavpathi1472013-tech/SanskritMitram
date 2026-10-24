// catalogue.js - everything about the catalogue that is NOT drawing on the page:
// fetching, checking the data, building URLs, and grouping lessons into a tree.

export const CATALOGUE_PATH = "data/lessons.json";
const SUPPORTED_VERSION = 1;
const LESSON_TYPES = new Set(["markdown", "pdf"]);

export class CatalogueError extends Error {}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

// "textbook/class 6/ch 1.pdf" -> "textbook/class%206/ch%201.pdf"
// Each piece between slashes is encoded; the slashes themselves are kept.
export function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

// Turns a repository path into a full address that works wherever the site
// lives, including GitHub Pages project sites such as
// https://username.github.io/repository/ - because it starts from the
// address of the current page instead of from "/".
export function resolveRepoUrl(path, base = document.baseURI) {
  return new URL(encodePath(path), base).href;
}

// A path from the catalogue must stay inside the site: no "..", no leading
// slash, no "https:" prefix, no backslashes.
export function isSafeRepoPath(path) {
  if (typeof path !== "string" || path === "") return false;
  if (path.includes("\\") || path.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(path)) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function fetchChecked(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // "no-cache" asks the browser to check with the server first, so visitors
    // see a freshly generated catalogue instead of an old cached copy.
    const response = await fetch(url, { cache: "no-cache", signal: controller.signal });
    if (!response.ok) throw new CatalogueError(`The server answered ${response.status} for ${url}`);
    return response;
  } catch (error) {
    if (error.name === "AbortError") throw new CatalogueError("The request took too long.");
    if (error instanceof CatalogueError) throw error;
    throw new CatalogueError("Could not reach the server. Check your internet connection.");
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCatalogue(timeoutMs = 15000) {
  const response = await fetchChecked(resolveRepoUrl(CATALOGUE_PATH), timeoutMs);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new CatalogueError("The lesson catalogue is not valid JSON.");
  }
  return validateCatalogue(data);
}

export async function fetchText(url, timeoutMs = 15000) {
  const response = await fetchChecked(url, timeoutMs);
  return response.text();
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isText = (value) => typeof value === "string" && value.trim() !== "";
const isTextList = (value) => Array.isArray(value) && value.every(isText);

function normalizeLesson(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!isText(raw.id) || !isSafeRepoPath(raw.path) || !LESSON_TYPES.has(raw.type)) return null;
  if (!isTextList(raw.sectionPath) || raw.sectionPath.length === 0) return null;

  const labels =
    isTextList(raw.sectionLabels) && raw.sectionLabels.length === raw.sectionPath.length
      ? raw.sectionLabels
      : raw.sectionPath;

  return {
    id: raw.id,
    title: isText(raw.title) ? raw.title.trim() : raw.path.split("/").pop(),
    type: raw.type,
    category: isText(raw.category) ? raw.category : raw.sectionPath[0],
    sectionPath: raw.sectionPath,
    sectionLabels: labels,
    path: raw.path,
    keywords: isTextList(raw.keywords) ? raw.keywords : [],
  };
}

// Returns { lessons, categories, skipped }. Throws CatalogueError when the
// file as a whole cannot be used. Single bad entries are skipped and counted.
export function validateCatalogue(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new CatalogueError("The lesson catalogue has an unexpected format.");
  }
  if (data.version !== SUPPORTED_VERSION) {
    throw new CatalogueError("The lesson catalogue uses a format this page does not understand.");
  }
  if (!Array.isArray(data.lessons)) {
    throw new CatalogueError("The lesson catalogue has no list of lessons.");
  }

  const lessons = [];
  const seen = new Set();
  let skipped = 0;
  for (const raw of data.lessons) {
    const lesson = normalizeLesson(raw);
    if (!lesson || seen.has(lesson.id)) {
      skipped++;
      continue;
    }
    seen.add(lesson.id);
    lessons.push(lesson);
  }

  const categories = Array.isArray(data.categories)
    ? data.categories.filter((c) => c && isText(c.id) && isText(c.label))
    : [];

  return { lessons, categories, skipped };
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

// Builds a tree like:
//   Textbooks
//     Class 6  -> lessons...
//     Class 7  -> lessons...
// Each node: { key, label, lessons: [], children: [] }.
// Sections appear in the order given by `categories`; the order inside a
// section follows the (already sorted) catalogue.
export function buildTree(lessons, categories = []) {
  const roots = new Map();

  const childOf = (siblings, key, label) => {
    if (!siblings.has(key)) siblings.set(key, { key, label, lessons: [], children: new Map() });
    return siblings.get(key);
  };

  for (const lesson of lessons) {
    let siblings = roots;
    let node = null;
    lesson.sectionPath.forEach((folder, depth) => {
      const key = lesson.sectionPath.slice(0, depth + 1).join("/");
      node = childOf(siblings, key, lesson.sectionLabels[depth]);
      siblings = node.children;
    });
    node.lessons.push(lesson);
  }

  const toArray = (node) => ({ ...node, children: [...node.children.values()].map(toArray) });
  const list = [...roots.values()].map(toArray);

  // Honour the section order and labels chosen in the generator.
  const rank = new Map(categories.map((c, index) => [c.id, index]));
  const labels = new Map(categories.map((c) => [c.id, c.label]));
  for (const node of list) if (labels.has(node.key)) node.label = labels.get(node.key);
  return list.sort((a, b) => (rank.get(a.key) ?? 1e6) - (rank.get(b.key) ?? 1e6));
}
