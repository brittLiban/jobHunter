"""
Helpers for loading resume text from local files.

DOCX support uses only the Python standard library so the pipeline does not
depend on python-docx or other heavyweight parsing libraries.
"""
from __future__ import annotations

import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


_DOCX_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
_MULTISPACE_RE = re.compile(r"[ \t]{2,}")
_MULTIBLANK_RE = re.compile(r"\n{3,}")


def load_resume_text(path: str | Path) -> str:
    """Load plain text from a .txt, .md, .docx, or .doc file path."""
    resume_path = Path(path).expanduser()
    if not resume_path.exists():
        raise FileNotFoundError(f"Resume file not found: {resume_path}")

    suffix = resume_path.suffix.lower()
    if suffix == ".docx":
        text = _extract_docx_text(resume_path)
    elif suffix in {".txt", ".md"}:
        text = resume_path.read_text(encoding="utf-8")
    else:
        raise ValueError(
            f"Unsupported resume format for {resume_path}. "
            "Use .docx, .txt, or .md."
        )

    return normalize_resume_text(text)


def normalize_resume_text(text: str) -> str:
    """Normalize whitespace so LLM prompts stay compact and readable."""
    cleaned_lines = []
    for raw_line in text.splitlines():
        line = _MULTISPACE_RE.sub(" ", raw_line.strip())
        if line:
            cleaned_lines.append(line)
        elif cleaned_lines and cleaned_lines[-1] != "":
            cleaned_lines.append("")

    cleaned = "\n".join(cleaned_lines).strip()
    return _MULTIBLANK_RE.sub("\n\n", cleaned)


def _extract_docx_text(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        document_xml = archive.read("word/document.xml")

    root = ET.fromstring(document_xml)
    paragraphs: list[str] = []
    for paragraph in root.findall(".//w:p", _DOCX_NS):
        texts = [node.text for node in paragraph.findall(".//w:t", _DOCX_NS) if node.text]
        if texts:
            paragraphs.append("".join(texts))

    return "\n".join(paragraphs)
