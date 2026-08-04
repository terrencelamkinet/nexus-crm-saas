"""NameCard OCR — tesseract-based text extraction + structured field parsing.

Fully self-contained in G08 (no link to GG Fighter / Hermes pipelines):
  1. tesseract OCR (chi_tra + eng) → raw text
  2. regex/heuristic parsing → structured fields
     (name, chinese_name, title, company, phone, office_phone, email,
      website, address, linkedin)
  3. Downstream (crm router) creates/links a Contact from the parsed fields.

SOC 2: image files are stored under backend/uploads/namecards/ and served
through an authenticated endpoint — no public static mount.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Any


def ocr_image(image_path: str | Path, langs: str = "chi_tra+eng") -> str:
    """Run tesseract on an image, return raw OCR text."""
    cmd = ["tesseract", str(image_path), "stdout", "-l", langs, "--psm", "6"]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        return (result.stdout or "").strip()
    except (subprocess.TimeoutExpired, FileNotFoundError):
        # fallback to single-language
        try:
            result = subprocess.run(
                ["tesseract", str(image_path), "stdout", "-l", "eng", "--psm", "6"],
                capture_output=True, text=True, timeout=60,
            )
            return (result.stdout or "").strip()
        except Exception:
            return ""


_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PHONE_RE = re.compile(r"(?:\+?\d{1,3}[ -]?)?(?:\(\d{2,4}\)[ -]?)?\d{3,4}[ -]?\d{3,4}(?:[ -]?\d{2,4})?")
_URL_RE = re.compile(r"(?:https?://)?(?:www\.)?[\w-]+\.(?:com|hk|cn|net|org|io|co|tw)(?:/[^\s]*)?", re.I)
_LINKEDIN_RE = re.compile(r"(?:linkedin\.com|領英)[^\s]*", re.I)
_TITLE_KEYWORDS = (
    "director", "manager", "engineer", "sales", "marketing", "consultant",
    "officer", "president", "founder", "ceo", "cto", "cfo", "vp", "head",
    "lead", "specialist", "analyst", "executive", "architect", "developer",
    "總監", "經理", "工程師", "銷售", "市場", "顧問", "主任", "總裁", "創辦人",
    "主席", "主管", "專員", "分析師", "行銷", "業務", "採購", "財務", "人事",
)


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().strip("|·•-–—")


def _is_title(line: str) -> bool:
    low = line.lower()
    if any(k in low for k in _TITLE_KEYWORDS):
        return True
    # 3-6 chars, mostly CJK, no digits — typical Chinese job titles
    cjk = sum(1 for ch in line if "\u4e00" <= ch <= "\u9fff")
    if cjk >= 2 and cjk == len(line) and len(line) <= 8:
        return True
    return False


_COMPANY_HINTS = (
    "ltd", "inc", "corp", "corporation", "co.", "co ", "group", "holdings",
    "limited", "company", "bank", "systex", "tech", "technology", "systems",
    "有限公司", "公司", "集團", "企業", "銀行", "科技", "國際", "控股",
)


def _is_company(line: str) -> bool:
    low = line.lower()
    return any(h in low for h in _COMPANY_HINTS) and len(line) <= 50


def parse_namecard(raw_text: str) -> dict[str, Any]:
    """Parse raw OCR text into structured namecard fields."""
    lines = [_clean(l) for l in raw_text.splitlines() if _clean(l)]
    if not lines:
        return {}

    # Multi-line text → single string for regex scans
    blob = "\n".join(lines)

    emails = list(dict.fromkeys(_EMAIL_RE.findall(blob)))
    urls = [u for u in _URL_RE.findall(blob) if "linkedin" not in u.lower()]
    linkedin = _LINKEDIN_RE.search(blob)
    phones = []
    for m in _PHONE_RE.finditer(blob):
        p = m.group(0)
        if len(re.sub(r"\D", "", p)) >= 7 and p not in phones:
            phones.append(p)

    # Classify lines: contact-ish (skip), title, company, name
    title = None
    company = None
    name_line = None
    skip_patterns = (_EMAIL_RE, _URL_RE, _PHONE_RE)

    for line in lines:
        if len(line) > 40:
            continue
        if any(p.search(line) for p in skip_patterns):
            continue
        if _is_title(line):
            if title is None:
                title = line
            continue
        if _is_company(line):
            if company is None:
                company = line
            continue
        if name_line is None and len(line) >= 2:
            name_line = line

    # Name heuristic: first remaining line with 2+ words (or 2+ CJK chars),
    # not a title / company / contact line
    if name_line is None:
        for line in lines:
            words = line.split()
            cjk_count = sum(1 for ch in line if "\u4e00" <= ch <= "\u9fff")
            if 0 < len(line) <= 30 and not any(p.search(line) for p in skip_patterns) \
                    and not _is_title(line) and not _is_company(line) \
                    and (len(words) >= 2 or cjk_count >= 2):
                name_line = line
                break

    # Chinese name detection — extract CJK run(s) from the name line
    chinese_name = None
    if name_line:
        cjk_runs = re.findall(r"[\u4e00-\u9fff]{2,5}", name_line)
        if cjk_runs:
            chinese_name = "".join(cjk_runs)

    # Split phone into mobile vs office by count of digits / common prefixes
    mobile, office = None, None
    for p in phones:
        digits = re.sub(r"\D", "", p)
        if mobile is None and (digits.startswith(("6", "9", "5")) or len(digits) == 8):
            mobile = p
        elif office is None:
            office = p

    return {
        "name": name_line or "",
        "chinese_name": chinese_name or "",
        "title": title or "",
        "company": company or "",
        "phone": mobile or (phones[0] if phones else ""),
        "office_phone": office or "",
        "email": emails[0] if emails else "",
        "emails": emails,
        "website": urls[0] if urls else "",
        "address": "",
        "linkedin": linkedin.group(0) if linkedin else "",
        "raw_lines": lines,
    }
