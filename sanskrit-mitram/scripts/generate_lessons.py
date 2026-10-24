#!/usr/bin/env python3
"""
generate_lessons.py - builds data/lessons.json for Sanskrit-Mitram.

It walks the content folders listed in CONTENT_DIRS, finds every .md and .pdf
file, and writes one catalogue entry per file. The folder a file lives in
decides its category and position on the website.

Only the Python standard library is used. Run it from anywhere:

    python3 scripts/generate_lessons.py

Optional flags (mostly for tests):
    --root PATH     repository root (default: the folder above scripts/)
    --output PATH   catalogue file, relative to root (default: data/lessons.json)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

# --------------------------------------------------------------------------
# Settings you may edit
# --------------------------------------------------------------------------

CATALOGUE_VERSION = 1

# Top-level content folders -> the heading shown on the website.
# The ORDER here is the order of the sections on the page.
# Anything deeper inside these folders is discovered automatically.
CONTENT_DIRS = {
    "vyakaran": "Grammar",
    "textbook": "Textbooks",
    "stories": "Stories",
    "shlokas": "Shlokas",
}

# File extension (lower case) -> "type" stored in the catalogue.
SUPPORTED_EXTENSIONS = {".md": "markdown", ".pdf": "pdf"}

# File names (lower case) that are never lessons, e.g. notes for contributors.
IGNORED_FILENAMES = {"readme.md"}

DEFAULT_OUTPUT = "data/lessons.json"

# --------------------------------------------------------------------------
# Markdown inspection
# --------------------------------------------------------------------------

FENCE_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
HEADING_RE = re.compile(r"^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*$")
# "#title: Sandhi" and "#keywords: sandhi, vowel". There is no space after
# the "#", so Markdown does not treat these lines as headings.
DIRECTIVE_RE = re.compile(r"^ {0,3}#(title|keywords)[ \t]*:[ \t]*(.*?)[ \t]*$", re.IGNORECASE)


def warn(message: str) -> None:
    print(f"WARNING: {message}", file=sys.stderr)


def clean_inline(text: str) -> str:
    """Turn '**Bold** [link](x)' into plain text for use as a title."""
    text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)  # images -> alt text
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)  # links -> link text
    text = re.sub(r"[`*~]+", "", text)  # code, bold, italic, strikethrough marks
    text = re.sub(r"(?<!\w)_+|_+(?!\w)", "", text)  # emphasis underscores only
    return re.sub(r"\s+", " ", text).strip()


def split_keywords(value: str) -> list[str]:
    parts = re.split(r"[,;]", value)
    return [re.sub(r"\s+", " ", p).strip() for p in parts if p.strip()]


def analyse_markdown(text: str) -> tuple[str | None, str | None, list[str]]:
    """Return (first_heading, directive_title, keywords).

    Lines inside ``` code fences are ignored, so a '# comment' in a code
    sample is never mistaken for a heading.
    """
    heading: str | None = None
    directive_title: str | None = None
    keywords: list[str] = []
    fence: tuple[str, int] | None = None  # (character, length) while inside a fence

    for line in text.splitlines():
        fence_match = FENCE_RE.match(line)
        if fence_match:
            marker = fence_match.group(1)
            if fence is None:
                fence = (marker[0], len(marker))
            elif marker[0] == fence[0] and len(marker) >= fence[1] and not fence_match.group(2).strip():
                fence = None
            continue
        if fence is not None:
            continue

        directive = DIRECTIVE_RE.match(line)
        if directive:
            name, value = directive.group(1).lower(), directive.group(2)
            if name == "title" and value and directive_title is None:
                directive_title = re.sub(r"\s+", " ", value).strip()
            elif name == "keywords":
                keywords.extend(split_keywords(value))
            continue

        if heading is None:
            found = HEADING_RE.match(line)
            if found:
                candidate = re.sub(r"[ \t]+#+$", "", found.group(2))  # closing ###
                candidate = clean_inline(candidate)
                if candidate:
                    heading = candidate

    unique: list[str] = []
    seen: set[str] = set()
    for word in keywords:
        key = word.casefold()
        if key not in seen:
            seen.add(key)
            unique.append(word)
    return heading, directive_title, unique


def read_markdown(path: Path) -> str | None:
    """Read a Markdown file as UTF-8. Return None (and warn) if it cannot be read."""
    try:
        data = path.read_bytes()
    except OSError as exc:
        warn(f"cannot read {path}: {exc}")
        return None
    try:
        return data.decode("utf-8-sig")  # utf-8-sig also removes a BOM
    except UnicodeDecodeError:
        warn(f"{path} is not valid UTF-8; using the file name as its title")
        return None


# --------------------------------------------------------------------------
# Names and ordering
# --------------------------------------------------------------------------

def humanize(name: str) -> str:
    """'shabda-roop' -> 'Shabda Roop', 'class_6' -> 'Class 6'."""
    name = unicodedata.normalize("NFC", name)
    name = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name)  # shabdaRoop -> shabda Roop
    name = re.sub(r"[-_\s]+", " ", name).strip()
    words = [w[:1].upper() + w[1:] for w in name.split(" ") if w]
    return " ".join(words)


def title_from_filename(filename: str) -> str:
    return humanize(Path(filename).stem) or filename


def natural_key(text: str) -> list[tuple[int, object]]:
    """Sort key so that 'chapter-2' comes before 'chapter-10'."""
    text = unicodedata.normalize("NFC", text).casefold()
    return [(0, int(p)) if p.isdigit() else (1, p) for p in re.split(r"(\d+)", text) if p]


# --------------------------------------------------------------------------
# Building the catalogue
# --------------------------------------------------------------------------

def make_lesson(root: Path, file_path: Path, category: str, kind: str, content_dirs: dict[str, str]) -> dict:
    relative = file_path.relative_to(root)
    parts = relative.parts
    section_path = list(parts[:-1])  # every folder above the file, top-level first

    title: str | None = None
    keywords: list[str] = []
    if kind == "markdown":
        text = read_markdown(file_path)
        if text is not None:
            heading, directive_title, keywords = analyse_markdown(text)
            title = directive_title or heading
    if not title:
        title = title_from_filename(parts[-1])

    labels = [content_dirs.get(category) or humanize(category)]
    labels += [humanize(folder) or folder for folder in section_path[1:]]

    return {
        "id": relative.as_posix(),
        "title": title,
        "type": kind,
        "category": category,
        "sectionPath": section_path,
        "sectionLabels": labels,
        "path": relative.as_posix(),
        "keywords": keywords,
    }


def build_catalogue(root: Path, content_dirs: dict[str, str] | None = None, exclude: tuple[Path, ...] = ()) -> dict:
    content_dirs = CONTENT_DIRS if content_dirs is None else content_dirs
    excluded = {p.resolve() for p in exclude}
    order = {name: index for index, name in enumerate(content_dirs)}

    lessons: dict[str, dict] = {}  # keyed by id, so duplicates are impossible
    categories: list[dict] = []

    for category, label in content_dirs.items():
        top = root / category
        if top.is_symlink() or not top.is_dir():
            warn(f"content folder '{category}' not found; skipping it")
            continue
        categories.append({"id": category, "label": label})

        for dirpath, dirnames, filenames in os.walk(top, followlinks=False):
            dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
            for filename in sorted(filenames):
                if filename.startswith(".") or filename.casefold() in IGNORED_FILENAMES:
                    continue
                kind = SUPPORTED_EXTENSIONS.get(Path(filename).suffix.lower())
                if kind is None:
                    continue
                file_path = Path(dirpath) / filename
                if file_path.is_symlink() or file_path.resolve() in excluded:
                    continue
                lesson = make_lesson(root, file_path, category, kind, content_dirs)
                lessons.setdefault(lesson["id"], lesson)

    def sort_key(lesson: dict):
        parts = lesson["path"].split("/")
        return (order[lesson["category"]], [natural_key(p) for p in parts], lesson["path"])

    return {
        "version": CATALOGUE_VERSION,
        "categories": categories,
        "lessons": sorted(lessons.values(), key=sort_key),
    }


def write_catalogue(output: Path, catalogue: dict) -> bool:
    """Write the catalogue. Returns True if the file changed."""
    text = json.dumps(catalogue, ensure_ascii=False, indent=2) + "\n"
    data = text.encode("utf-8")
    try:
        if output.read_bytes() == data:
            return False
    except OSError:
        pass
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + ".tmp")
    temporary.write_bytes(data)
    os.replace(temporary, output)  # replace in one step, never a half-written file
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate the Sanskrit-Mitram lesson catalogue.")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--output", type=Path, default=Path(DEFAULT_OUTPUT))
    args = parser.parse_args(argv)

    root = args.root.resolve()
    output = args.output if args.output.is_absolute() else root / args.output

    catalogue = build_catalogue(root, exclude=(output,))
    try:
        changed = write_catalogue(output, catalogue)
    except OSError as exc:
        print(f"ERROR: could not write {output}: {exc}", file=sys.stderr)
        return 1

    count = len(catalogue["lessons"])
    state = "updated" if changed else "already up to date"
    shown = output.relative_to(root) if output.is_relative_to(root) else output
    print(f"{shown}: {count} lesson(s), {state}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
