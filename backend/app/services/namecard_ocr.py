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
    """Run tesseract on an image → best multi-pass OCR text.

    Real photos are noisy: PSM 6 (block) + PSM 11 (sparse) on both enhanced
    and raw image; candidates are scored (email/phone/domain signals, CJK
    noise penalty) and signal-rich ones merged line-wise (dedup, order kept).
    """
    import cv2  # opencv-python-headless

    image_path = str(image_path)
    # 1) Enhance: landscape-orient fix + CLAHE + denoise + 2x upscale
    img = cv2.imread(image_path)
    enhanced_path = None
    if img is not None:
        h, w = img.shape[:2]
        if h > w * 1.2:
            img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        denoised = cv2.fastNlMeansDenoising(clahe.apply(gray), None, 10, 7, 21)
        blur = cv2.GaussianBlur(denoised, (0, 0), 2.0)
        sharp = cv2.addWeighted(denoised, 1.6, blur, -0.6, 0)
        big = cv2.resize(sharp, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        import tempfile
        enhanced_path = Path(tempfile.mkdtemp()) / "nc_enhanced.png"
        cv2.imwrite(str(enhanced_path), big)

    def _run(path: str, psm: str, lang: str) -> str:
        try:
            r = subprocess.run(
                ["tesseract", path, "stdout", "-l", lang, "--psm", psm],
                capture_output=True, text=True, timeout=60,
            )
            return (r.stdout or "").strip()
        except Exception:
            return ""

    candidates: list[str] = []
    sources = [enhanced_path] if enhanced_path else []
    sources.append(image_path)
    for path in sources:
        for psm in ("6", "11"):
            candidates.append(_run(path, psm, "chi_tra+eng"))
            candidates.append(_run(path, psm, "eng"))

    if enhanced_path is not None:
        try:
            import shutil
            shutil.rmtree(str(enhanced_path.parent))
        except OSError:
            pass

    def score(txt: str) -> float:
        s = len(txt) * 0.05
        if re.search(r"@", txt):
            s += 300
        if re.search(r"\b\+?\d{8,}\b", txt):
            s += 150
        if re.search(r"\.com|\.hk|www\.", txt):
            s += 100
        if re.search(r"\b(manager|director|sales|engineer|consultant|officer|account)\b", txt, re.I):
            s += 50
        cjk = sum(1 for ch in txt if "\u4e00" <= ch <= "\u9fff")
        total_alpha = sum(1 for ch in txt if ch.isalpha())
        if total_alpha and cjk / total_alpha > 0.4:
            s -= 400
        s -= sum(1 for ch in txt if ch in "|\\/=-_~*#@&%^") * 0.5
        return s

    ranked = sorted(candidates, key=score, reverse=True)
    if not ranked or not ranked[0]:
        return ""
    merged: list[str] = []
    seen: set[str] = set()
    for txt in ranked:
        if score(txt) < 200 and txt != ranked[0]:
            continue
        for ln in txt.splitlines():
            ln_clean = re.sub(r"\s+", " ", ln).strip()
            if ln_clean and ln_clean not in seen:
                seen.add(ln_clean)
                merged.append(ln_clean)
    return "\n".join(merged)


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

    # Pass 0: strong name signal — exactly 2..4 capitalized words (e.g. "Marco Chan"),
    # no digits/symbols. Real names; OCR garbage rarely forms this pattern.
    _CAP_WORD = re.compile(r"^[A-Z][a-zA-Z'’-]+$")
    for line in lines:
        if not (1 <= len(line) <= 30) or any(p.search(line) for p in skip_patterns):
            continue
        words = line.split()
        if not (2 <= len(words) <= 4):
            continue
        if all(_CAP_WORD.match(w) for w in words):
            name_line = line
            break

    for line in lines:
        if line == name_line:
            continue
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
