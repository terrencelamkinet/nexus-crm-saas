"""Company name web enrichment — 開源 Playwright，零外部資源。

用法：`enrich_company_web(query)` 對一個公司名做網上查證，回傳結構化 facts。
任何失敗一律 return None（caller fallback 去原本 extraction 行為），唔會 throw。
"""
from __future__ import annotations

import re
import urllib.parse
from typing import Any

from playwright.async_api import async_playwright

# 非官方 / 唔應該當公司官方站嘅 domain（或 domain 內含呢啲字）→ skip
_NON_OFFICIAL = (
    "wikipedia", "linkedin", "facebook", "twitter", "x.com", "youtube",
    "crunchbase", "zoominfo", "glassdoor", "indeed", "bloomberg", "reuters",
    "google", "bing", "duckduckgo", "yelp", "trustpilot", "forbes", "cnbc",
    "bbc", "cnn", "yahoo", "news", "gov", "edu",
)

# 公司 domain 優先級（越前越 preferred）
_DOMAIN_PREF = (".com", ".com.hk", ".hk", ".cn", ".com.cn", ".net", ".org", ".io", ".co")

# 全頁 time budget（秒）— 所有 navigation 加埋唔好超
_TOTAL_BUDGET_SEC = 15.0


def _decode_ddg_href(href: str | None) -> str | None:
    """DDG html result 條 href 通常係 `//duckduckgo.com/l/?uddg=<urlencoded>` → decode 返真實 URL。"""
    if not href:
        return None
    href = href.strip()
    if href.startswith("//"):
        href = "https:" + href
    if "uddg=" in href:
        # urlsplit 處理 query 內有 & 嘅情況
        q = urllib.parse.urlsplit(href).query
        params = urllib.parse.parse_qs(q)
        uddg = params.get("uddg")
        if uddg:
            return urllib.parse.unquote(uddg[0])
    if href.startswith("http"):
        return href
    return None


def _decode_bing_href(href: str | None) -> str | None:
    """Bing `/ck/a` 結果係 redirect link，真實 URL 喺 `u=a1<base64>` param → decode。"""
    if not href:
        return None
    href = href.strip()
    if "u=a1" not in href:
        if href.startswith("http"):
            return href
        return None
    q = urllib.parse.urlsplit(href).query
    params = urllib.parse.parse_qs(q)
    u = (params.get("u") or [""])[0]
    if not u.startswith("a1"):
        return None
    b = u[2:]
    try:
        import base64 as _b64
        padded = b + "=" * ((4 - len(b) % 4) % 4)
        return _b64.b64decode(padded).decode("utf-8", errors="ignore") or None
    except Exception:
        return None


def _is_blacklisted(url: str) -> bool:
    host = (urllib.parse.urlsplit(url).netloc or "").lower()
    for b in _NON_OFFICIAL:
        if b in host:
            return True
    return False


def _domain_pref_score(url: str) -> int:
    host = (urllib.parse.urlsplit(url).netloc or "").lower()
    for i, suf in enumerate(_DOMAIN_PREF):
        if host.endswith(suf):
            return len(_DOMAIN_PREF) - i
    return 0


def _clean_company_name(raw: str | None) -> str | None:
    """由 title / og:title 抽公司全名：drop tagline（` - ` / ` | ` 之後）、摺疊空白、cap length。"""
    if not raw:
        return None
    s = re.sub(r"\s+", " ", raw.strip())
    # 取第一個 separator 之前嘅 segment（e.g. 「新华三 - 融绘数字未来」→「新华三」）
    for sep in (" | ", " - ", " — ", " – ", " -", " |"):
        if sep in s:
            s = s.split(sep, 1)[0].strip()
            break
    s = s.strip(" -–—|,。")
    if not s:
        return None
    if len(s) > 120:
        s = s[:120].rstrip()
    return s


async def _search_ddg(page: Any, query: str) -> list[dict[str, Any]]:
    """DDG HTML search → top 5 results（decode uddg redirect）。"""
    search_url = "https://html.duckduckgo.com/html/?q=" + urllib.parse.quote(query)
    await page.goto(search_url, timeout=8000, wait_until="domcontentloaded")
    results = await page.eval_on_selector_all(
        ".result",
        """els => els.slice(0, 5).map(el => {
            const a = el.querySelector('.result__a');
            const s = el.querySelector('.result__snippet');
            return {
              title: a ? (a.textContent || '').trim() : '',
              href: a ? (a.getAttribute('href') || '') : '',
              snippet: s ? (s.textContent || '').trim() : ''
            };
        })""",
    )
    decoded = []
    for r in results:
        url = _decode_ddg_href(r.get("href"))
        if url:
            decoded.append({"title": r.get("title", ""), "url": url, "snippet": r.get("snippet", "")})
    return decoded


async def _search_bing(page: Any, query: str) -> list[dict[str, Any]]:
    """Bing search fallback（DDG 喺 server IP 成日被 block）→ top 5 organic results。"""
    search_url = "https://www.bing.com/search?q=" + urllib.parse.quote(query)
    await page.goto(search_url, timeout=8000, wait_until="domcontentloaded")
    results = await page.eval_on_selector_all(
        "li.b_algo",
        """els => els.slice(0, 5).map(el => {
            const h2 = el.querySelector('h2 a');
            const p = el.querySelector('p');
            return {
              title: h2 ? (h2.textContent || '').trim() : '',
              href: h2 ? (h2.getAttribute('href') || '') : '',
              snippet: p ? (p.textContent || '').trim() : ''
            };
        })""",
    )
    decoded = []
    for r in results:
        url = _decode_bing_href(r.get("href"))
        if url:
            decoded.append({"title": r.get("title", ""), "url": url, "snippet": r.get("snippet", "")})
    return decoded


def _pick_official(results: list[dict[str, Any]], query: str) -> dict[str, Any] | None:
    """由 DDG top results 揀官方站。

    Scoring：domain 包含 query token 加分最多；title 包含 query + 官方字眼加分；
    加埋 domain 優先級。揀唔到就 return None。
    """
    q_tokens = [t for t in re.split(r"[\s\W_]+", query.lower()) if t]
    best: dict[str, Any] | None = None
    best_score = -1.0
    for r in results:
        url = r.get("url") or ""
        title = (r.get("title") or "").lower()
        if not url or _is_blacklisted(url):
            continue
        host = (urllib.parse.urlsplit(url).netloc or "").lower()
        score = 0.0
        # domain 包含 query token → 最強訊號（例如 query「h3c」→ domain「h3c.com」）
        for tok in q_tokens:
            if tok and tok in host:
                score += 3.0
        # title 包含 query 關鍵字
        if any(tok and tok in title for tok in q_tokens):
            score += 1.5
        # title 有官方字眼
        if any(w in title for w in ("official", "官网", "官方", "官網")) and any(
            tok and tok in title for tok in q_tokens
        ):
            score += 1.0
        # domain 優先級
        score += _domain_pref_score(url) * 0.25
        if score > best_score:
            best_score = score
            best = r
    if best and best_score > 0:
        return best
    return None


def _extract_emails(text: str | None) -> list[str]:
    if not text:
        return []
    found = re.findall(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", text)
    seen: list[str] = []
    for e in found:
        e = e.strip().lower().rstrip(".")
        if e and e not in seen and "example" not in e and "sentry" not in e and "wixpress" not in e:
            seen.append(e)
    return seen[:5]


def _extract_phones(text: str | None) -> str | None:
    if not text:
        return None
    found = re.findall(r"\+?\d[\d\s()\-]{7,}", text)
    for p in found:
        p = p.strip()
        digits = re.sub(r"\D", "", p)
        if len(digits) < 7 or len(digits) > 15:
            continue
        # 排除版權年份 range（e.g. 「2003-2026」）— 似 `20XX-20XX` 唔係電話
        if re.fullmatch(r"20\d{2}\s*-\s*20\d{2}", p.strip()):
            continue
        # 排除純年份組合
        if re.fullmatch(r"(?:20\d{2})[\s\-]*(?:20\d{2})?", p.strip()) and len(digits) <= 8:
            continue
        return p
    return None


async def _scrape_facts(page: Any, url: str, deadline: float) -> dict[str, Any]:
    """開官方站抽 facts。任何一步失敗都唔 throw（best-effort）。deadline = time.monotonic 上限。"""
    import time as _time
    facts: dict[str, Any] = {
        "full_name": None,
        "domain": None,
        "website": url,
        "description": None,
        "phone": None,
        "address": None,
        "emails": [],
    }
    try:
        facts["domain"] = (urllib.parse.urlsplit(url).netloc or "").replace("www.", "").lower()
    except Exception:
        pass
    # 先導航去官方站（title / og:title / meta 都要喺呢個 page 讀）
    try:
        await page.goto(url, timeout=8000, wait_until="domcontentloaded")
    except Exception:
        pass
    # title + og:title（prefer og:title，其次 page title）
    title_text = None
    og_title = None
    try:
        og_title = await page.eval_on_selector(
            'meta[property="og:title"]', "el => el.getAttribute('content')"
        )
    except Exception:
        pass
    try:
        if not og_title:
            title_text = await page.title()
    except Exception:
        pass
    name_src = (og_title or title_text or "").strip()
    facts["full_name"] = _clean_company_name(name_src) or None

    # meta description + og:description
    desc = None
    try:
        desc = await page.eval_on_selector(
            'meta[name="description"]', "el => el.getAttribute('content')"
        )
        if not desc:
            desc = await page.eval_on_selector(
                'meta[property="og:description"]', "el => el.getAttribute('content')"
            )
    except Exception:
        pass
    facts["description"] = (desc or "").strip() or None

    # 首個 h1
    try:
        h1 = await page.eval_on_selector("h1", "el => el.textContent")
        h1 = (h1 or "").strip()
        if h1 and len(h1) < 200 and not facts["full_name"]:
            facts["full_name"] = h1
        elif h1 and len(h1) < 200 and facts["full_name"] and h1 not in facts["full_name"]:
            pass
    except Exception:
        pass

    # body 抽 email / 電話 / 地址（off page 首頁 + 嘗試 /about /contact）
    page_text = ""
    try:
        page_text = await page.evaluate("() => document.body ? document.body.innerText.slice(0, 6000) : ''")
    except Exception:
        pass
    facts["emails"] = _extract_emails(page_text + " " + (desc or ""))
    ph = _extract_phones(page_text)
    if ph:
        facts["phone"] = ph

    # best-effort 開 /about、/about-us、/contact
    for sub in ("/about", "/about-us", "/about/", "/contact", "/contact-us"):
        if _time.monotonic() > deadline:
            break
        try:
            sub_url = urllib.parse.urljoin(url, sub)
            await page.goto(sub_url, timeout=4000, wait_until="domcontentloaded")
            sub_text = await page.evaluate(
                "() => document.body ? document.body.innerText.slice(0, 6000) : ''"
            )
            sms = _extract_emails(sub_text)
            for e in sms:
                if e not in facts["emails"]:
                    facts["emails"].append(e)
            if not facts["phone"]:
                ph2 = _extract_phones(sub_text)
                if ph2:
                    facts["phone"] = ph2
        except Exception:
            continue  # 失敗就 skip，唔好令成個 function 失敗

    return facts


async def enrich_company_web(query: str) -> dict | None:
    """開源 browser 公司 enrichment：DDG search → 揀官方站 → 抽 facts。

    任何失敗 return None（caller fallback 去原本行為）。總 budget ~15s。
    """
    if not query or not query.strip():
        return None
    import time as _time
    _deadline = _time.monotonic() + _TOTAL_BUDGET_SEC
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            try:
                context = await browser.new_context(
                    user_agent=(
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
                    )
                )
                page = await context.new_page()

                # Step 1 — Search（DDG 主，被 block 時 fallback Bing）
                decoded: list[dict[str, Any]] = []
                for searcher in (_search_ddg, _search_bing):
                    try:
                        decoded = await searcher(page, query)
                    except Exception:
                        decoded = []
                    if decoded:
                        break

                # Step 2 — 揀官方站
                best = _pick_official(decoded, query)
                if not best:
                    return None

                # Step 3 — 開官方站抽 facts
                facts = await _scrape_facts(page, best["url"], _deadline)
                return facts
            finally:
                await browser.close()
    except Exception:
        # 任何失敗（browser 起唔到 / sandbox / network）都 graceful → None
        return None
