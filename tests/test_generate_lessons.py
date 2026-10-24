"""
Tests for scripts/generate_lessons.py

Run from the repository root:
    python3 -m unittest discover -s tests -v
"""

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import generate_lessons as gl  # noqa: E402


class CatalogueTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        for name in gl.CONTENT_DIRS:
            (self.root / name).mkdir()

    # helpers -------------------------------------------------------------
    def add(self, relative, content=""):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            path.write_bytes(content)
        else:
            path.write_text(content, encoding="utf-8")
        return path

    def build(self):
        with contextlib.redirect_stderr(io.StringIO()):
            return gl.build_catalogue(self.root)

    def lessons(self):
        return self.build()["lessons"]

    def ids(self):
        return [lesson["id"] for lesson in self.lessons()]

    def lesson(self, lesson_id):
        matches = [x for x in self.lessons() if x["id"] == lesson_id]
        self.assertEqual(len(matches), 1, f"{lesson_id} not found exactly once")
        return matches[0]


class TitleTests(CatalogueTestCase):
    def test_first_heading_is_title(self):
        self.add("vyakaran/sandhi.md", "Intro text\n\n# Sandhi Rules\n\n## Later\n")
        self.assertEqual(self.lesson("vyakaran/sandhi.md")["title"], "Sandhi Rules")

    def test_any_heading_level_counts(self):
        self.add("vyakaran/a.md", "### Third level first\n# Then h1\n")
        self.assertEqual(self.lesson("vyakaran/a.md")["title"], "Third level first")

    def test_inline_markup_removed_from_heading(self):
        self.add("vyakaran/a.md", "# **Bold** and [a link](http://x.y) `code` ##\n")
        self.assertEqual(self.lesson("vyakaran/a.md")["title"], "Bold and a link code")

    def test_no_heading_uses_filename(self):
        self.add("vyakaran/lyap-pratyay.md", "Just a paragraph.\n")
        self.assertEqual(self.lesson("vyakaran/lyap-pratyay.md")["title"], "Lyap Pratyay")

    def test_filename_without_separators(self):
        self.add("vyakaran/lyappratyay.md", "text")
        self.assertEqual(self.lesson("vyakaran/lyappratyay.md")["title"], "Lyappratyay")

    def test_underscores_and_camel_case_in_filename(self):
        self.add("vyakaran/shabda_roop.md", "x")
        self.add("vyakaran/dhaatuRoop.md", "x")
        self.assertEqual(self.lesson("vyakaran/shabda_roop.md")["title"], "Shabda Roop")
        self.assertEqual(self.lesson("vyakaran/dhaatuRoop.md")["title"], "Dhaatu Roop")

    def test_pdf_title_from_filename(self):
        self.add("textbook/class-6/chapter-1.pdf", b"%PDF-1.4")
        self.assertEqual(self.lesson("textbook/class-6/chapter-1.pdf")["title"], "Chapter 1")

    def test_hashtag_title_beats_heading(self):
        self.add("vyakaran/a.md", "#title: My Custom Title\n#keywords: sandhi, vowel; Sandhi , joining\n\n# Heading\n")
        found = self.lesson("vyakaran/a.md")
        self.assertEqual(found["title"], "My Custom Title")
        self.assertEqual(found["keywords"], ["sandhi", "vowel", "joining"])  # duplicate removed

    def test_hashtag_without_space_is_not_a_heading(self):
        self.add("vyakaran/a.md", "#keywords: x\n")
        self.assertEqual(self.lesson("vyakaran/a.md")["title"], "A")  # falls back to filename

    def test_heading_inside_code_fence_ignored(self):
        self.add("vyakaran/a.md", "```python\n# comment, not a heading\n```\n\n# Real Title\n")
        self.assertEqual(self.lesson("vyakaran/a.md")["title"], "Real Title")

    def test_directive_inside_code_fence_ignored(self):
        self.add("vyakaran/a.md", "~~~\n#title: Fake\n~~~\n# Real\n")
        self.assertEqual(self.lesson("vyakaran/a.md")["title"], "Real")

    def test_quiz_block_does_not_change_catalogue_entry(self):
        # Quizzes live inside a ```quiz-json fence, which the generator ignores,
        # so the title still comes from the real heading and no code change is needed.
        quiz = '```quiz-json\n{"id": "q-1", "title": "T", "questions": []}\n```\n'
        self.add("vyakaran/with-quiz.md", "Intro\n\n" + quiz + "\n# Real Title\n#keywords: sandhi\n")
        found = self.lesson("vyakaran/with-quiz.md")
        self.assertEqual(found["title"], "Real Title")
        self.assertEqual(found["keywords"], ["sandhi"])
        self.assertEqual(set(found), {"id", "title", "type", "category", "sectionPath", "sectionLabels", "path", "keywords"})

    def test_devanagari_heading(self):
        self.add("vyakaran/sandhi.md", "# सन्धिः\n")
        self.assertEqual(self.lesson("vyakaran/sandhi.md")["title"], "सन्धिः")

    def test_bom_and_crlf(self):
        self.add("vyakaran/a.md", b"\xef\xbb\xbf# With BOM\r\n\r\ntext\r\n")
        self.assertEqual(self.lesson("vyakaran/a.md")["title"], "With BOM")

    def test_empty_markdown_file(self):
        self.add("vyakaran/empty-file.md", "")
        self.assertEqual(self.lesson("vyakaran/empty-file.md")["title"], "Empty File")


class DiscoveryTests(CatalogueTestCase):
    def test_example_paths_from_the_brief(self):
        for rel in [
            "vyakaran/sandhi.md",
            "vyakaran/shabda-roop.pdf",
            "textbook/class-6/chapter-1.pdf",
            "textbook/class-7/chapter-2.md",
            "stories/moral-stories/story-1.md",
            "shlokas/bhagavad-gita/chapter-2.pdf",
        ]:
            self.add(rel, "# x\n" if rel.endswith(".md") else b"%PDF")
        by_id = {x["id"]: x for x in self.lessons()}
        self.assertEqual(len(by_id), 6)
        self.assertEqual(by_id["vyakaran/sandhi.md"]["sectionLabels"], ["Grammar"])
        self.assertEqual(by_id["textbook/class-6/chapter-1.pdf"]["sectionLabels"], ["Textbooks", "Class 6"])
        self.assertEqual(by_id["textbook/class-6/chapter-1.pdf"]["sectionPath"], ["textbook", "class-6"])
        self.assertEqual(by_id["stories/moral-stories/story-1.md"]["sectionLabels"], ["Stories", "Moral Stories"])
        self.assertEqual(by_id["shlokas/bhagavad-gita/chapter-2.pdf"]["category"], "shlokas")
        self.assertEqual(by_id["vyakaran/shabda-roop.pdf"]["type"], "pdf")
        self.assertEqual(by_id["vyakaran/sandhi.md"]["type"], "markdown")

    def test_extension_case_is_ignored(self):
        self.add("vyakaran/a.MD", "# A\n")
        self.add("vyakaran/b.Pdf", b"%PDF")
        self.assertEqual(self.ids(), ["vyakaran/a.MD", "vyakaran/b.Pdf"])

    def test_unsupported_files_ignored(self):
        for rel in ["vyakaran/notes.txt", "vyakaran/pic.png", "vyakaran/page.html", "vyakaran/noextension"]:
            self.add(rel, "x")
        self.assertEqual(self.ids(), [])

    def test_deeply_nested_and_new_folders_need_no_code_change(self):
        self.add("textbook/class-8/unit-1/part-a/ch-1.md", "# Deep\n")
        found = self.lesson("textbook/class-8/unit-1/part-a/ch-1.md")
        self.assertEqual(found["sectionPath"], ["textbook", "class-8", "unit-1", "part-a"])
        self.assertEqual(found["sectionLabels"], ["Textbooks", "Class 8", "Unit 1", "Part A"])

    def test_spaces_and_unicode_in_names(self):
        self.add("vyakaran/शब्द रूप.md", "text")
        self.add("stories/मूर्ख भृत्य/कथा 1.pdf", b"%PDF")
        found = self.lesson("stories/मूर्ख भृत्य/कथा 1.pdf")
        self.assertEqual(found["path"], "stories/मूर्ख भृत्य/कथा 1.pdf")
        self.assertEqual(found["sectionPath"], ["stories", "मूर्ख भृत्य"])
        self.assertEqual(self.lesson("vyakaran/शब्द रूप.md")["title"], "शब्द रूप")

    def test_folders_outside_content_dirs_ignored(self):
        self.add("css/readme-style.md", "# nope\n")
        self.add("scripts/notes.md", "# nope\n")
        self.add(".github/workflows/x.md", "# nope\n")
        self.add("data/other.pdf", b"%PDF")
        self.add("random/file.md", "# nope\n")
        self.add("top-level.md", "# nope\n")
        self.assertEqual(self.ids(), [])

    def test_hidden_files_and_folders_ignored(self):
        self.add("vyakaran/.hidden.md", "# h\n")
        self.add("vyakaran/.drafts/a.md", "# h\n")
        self.assertEqual(self.ids(), [])

    def test_readme_ignored(self):
        self.add("vyakaran/README.md", "# For contributors\n")
        self.add("vyakaran/readme.md", "# For contributors\n")
        self.assertEqual(self.ids(), [])

    def test_generated_catalogue_never_a_lesson(self):
        output = self.root / "vyakaran" / "lessons.md"  # worst case: output inside content
        self.add("vyakaran/real.md", "# Real\n")
        output.write_text("# catalogue\n", encoding="utf-8")
        with contextlib.redirect_stderr(io.StringIO()):
            catalogue = gl.build_catalogue(self.root, exclude=(output,))
        self.assertEqual([x["id"] for x in catalogue["lessons"]], ["vyakaran/real.md"])

    def test_symlinks_are_skipped(self):
        target = self.add("vyakaran/real.md", "# Real\n")
        link = self.root / "vyakaran" / "link.md"
        try:
            link.symlink_to(target)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks not supported here")
        self.assertEqual(self.ids(), ["vyakaran/real.md"])


class ChangeTests(CatalogueTestCase):
    def test_add_edit_rename_move_delete(self):
        path = self.add("vyakaran/sandhi.md", "# Sandhi\n")
        self.assertEqual(self.ids(), ["vyakaran/sandhi.md"])

        path.write_text("# Sandhi (updated)\n", encoding="utf-8")
        self.assertEqual(self.lesson("vyakaran/sandhi.md")["title"], "Sandhi (updated)")

        path.rename(self.root / "vyakaran" / "sandhi-prakaran.md")
        self.assertEqual(self.ids(), ["vyakaran/sandhi-prakaran.md"])

        (self.root / "textbook" / "class-6").mkdir()
        (self.root / "vyakaran" / "sandhi-prakaran.md").rename(self.root / "textbook" / "class-6" / "sandhi.md")
        found = self.lesson("textbook/class-6/sandhi.md")
        self.assertEqual(found["sectionLabels"], ["Textbooks", "Class 6"])
        self.assertEqual(len(self.ids()), 1)

        (self.root / "textbook" / "class-6" / "sandhi.md").unlink()
        self.assertEqual(self.ids(), [])


class RobustnessTests(CatalogueTestCase):
    def test_empty_content_dirs(self):
        catalogue = self.build()
        self.assertEqual(catalogue["lessons"], [])
        self.assertEqual([c["id"] for c in catalogue["categories"]], list(gl.CONTENT_DIRS))

    def test_missing_content_dirs(self):
        for name in gl.CONTENT_DIRS:
            (self.root / name).rmdir()
        catalogue = self.build()
        self.assertEqual(catalogue, {"version": 1, "categories": [], "lessons": []})

    def test_invalid_utf8_falls_back_to_filename(self):
        self.add("vyakaran/broken-file.md", b"# Caf\xe9 \xff\xfe\n")
        found = self.lesson("vyakaran/broken-file.md")
        self.assertEqual(found["title"], "Broken File")
        self.assertEqual(found["keywords"], [])

    def test_unreadable_file_falls_back_to_filename(self):
        self.add("vyakaran/locked-file.md", "# Secret\n")
        original = Path.read_bytes

        def fake(self_path):
            if self_path.name == "locked-file.md":
                raise PermissionError("denied")
            return original(self_path)

        with mock.patch.object(Path, "read_bytes", fake):
            found = self.lesson("vyakaran/locked-file.md")
        self.assertEqual(found["title"], "Locked File")

    def test_invalid_file_does_not_stop_others(self):
        self.add("vyakaran/bad.md", b"\xff\xfe\x00")
        self.add("vyakaran/good.md", "# Good\n")
        self.assertEqual(self.ids(), ["vyakaran/bad.md", "vyakaran/good.md"])


class OrderingAndOutputTests(CatalogueTestCase):
    def test_natural_sort(self):
        for n in (10, 2, 1):
            self.add(f"textbook/class-6/chapter-{n}.pdf", b"%PDF")
        self.assertEqual(
            self.ids(),
            [f"textbook/class-6/chapter-{n}.pdf" for n in (1, 2, 10)],
        )

    def test_sections_follow_config_order(self):
        self.add("shlokas/a.md", "x")
        self.add("vyakaran/a.md", "x")
        self.add("stories/a.md", "x")
        self.add("textbook/a.md", "x")
        self.assertEqual(
            [x["category"] for x in self.lessons()],
            ["vyakaran", "textbook", "stories", "shlokas"],
        )

    def test_deterministic_and_no_duplicates(self):
        self.add("vyakaran/a.md", "# A\n")
        self.add("vyakaran/b.pdf", b"%PDF")
        self.add("textbook/class-7/c.md", "# C\n")
        first = json.dumps(self.build())
        second = json.dumps(self.build())
        self.assertEqual(first, second)
        ids = self.ids()
        self.assertEqual(len(ids), len(set(ids)))

    def test_every_lesson_has_the_documented_fields(self):
        self.add("textbook/class-6/chapter-1.md", "# One\n")
        expected = {"id", "title", "type", "category", "sectionPath", "sectionLabels", "path", "keywords"}
        self.assertEqual(set(self.lessons()[0]), expected)

    def test_write_catalogue_only_changes_when_needed(self):
        self.add("vyakaran/a.md", "# A\n")
        output = self.root / "data" / "lessons.json"
        catalogue = self.build()
        self.assertTrue(gl.write_catalogue(output, catalogue))  # first write creates data/
        self.assertFalse(gl.write_catalogue(output, catalogue))  # same content: no change
        self.assertFalse(output.with_name("lessons.json.tmp").exists())
        loaded = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(loaded, catalogue)
        self.assertTrue(output.read_text(encoding="utf-8").endswith("\n"))

    def test_unicode_not_escaped_in_json(self):
        self.add("vyakaran/शब्द.md", "# सन्धिः\n")
        output = self.root / "data" / "lessons.json"
        gl.write_catalogue(output, self.build())
        self.assertIn("सन्धिः", output.read_text(encoding="utf-8"))

    def test_main_end_to_end(self):
        self.add("vyakaran/a.md", "# A\n")
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = gl.main(["--root", str(self.root)])
        self.assertEqual(code, 0)
        data = json.loads((self.root / "data" / "lessons.json").read_text(encoding="utf-8"))
        self.assertEqual([x["id"] for x in data["lessons"]], ["vyakaran/a.md"])
        self.assertIn("1 lesson", out.getvalue())


if __name__ == "__main__":
    unittest.main()
