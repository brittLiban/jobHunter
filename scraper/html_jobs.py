"""
scraper/html_jobs.py - Shared HTML parsing helpers for job discovery.

These utilities intentionally stay dependency-light so the project can crawl
company sites and ATS-hosted pages without adding BeautifulSoup/lxml.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from html.parser import HTMLParser
from io import BytesIO
from typing import Any
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse
from xml.etree import ElementTree as ET


_JSON_LD_RE = re.compile(
    r"<script[^>]*type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
    re.IGNORECASE | re.DOTALL,
)
_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_BODY_RE = re.compile(r"<body[^>]*>(.*?)</body>", re.IGNORECASE | re.DOTALL)
_META_RE = re.compile(
    r"<meta[^>]+(?:name|property)=[\"']([^\"']+)[\"'][^>]+content=[\"']([^\"']*)[\"'][^>]*>",
    re.IGNORECASE,
)
_SCRIPT_STYLE_RE = re.compile(
    r"<(script|style|noscript|svg)[^>]*>.*?</\1>",
    re.IGNORECASE | re.DOTALL,
)
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\s{2,}")
_KEYWORD_RE = re.compile(
    r"(career|job|opening|position|opportunit|role|intern)",
    re.IGNORECASE,
)
_ATS_HOST_KEYWORDS = (
    "greenhouse.io",
    "lever.co",
    "ashbyhq.com",
    "workable.com",
)
_TRACKING_QUERY_PARAMS = {
    "fbclid",
    "gclid",
    "gh_src",
    "gh_src_id",
    "mc_cid",
    "mc_eid",
    "ref",
    "source",
}


class _LinkExtractor(HTMLParser):
    def __init__(self, base_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.links: list[dict[str, str]] = []
        self._current_href: str | None = None
        self._text_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        attrs_dict = dict(attrs)
        href = attrs_dict.get("href")
        if not href:
            return
        self._current_href = urljoin(self.base_url, href)
        self._text_parts = []

    def handle_data(self, data: str) -> None:
        if self._current_href is not None:
            self._text_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "a" or self._current_href is None:
            return
        text = _normalize_space(" ".join(self._text_parts))
        self.links.append({"url": self._current_href, "text": text})
        self._current_href = None
        self._text_parts = []


def extract_links(html: str, base_url: str) -> list[dict[str, str]]:
    parser = _LinkExtractor(base_url)
    parser.feed(html)
    seen: set[str] = set()
    unique: list[dict[str, str]] = []
    for item in parser.links:
        url = item["url"]
        if url in seen:
            continue
        seen.add(url)
        unique.append(item)
    return unique


def extract_jobposting_objects(html: str) -> list[dict[str, Any]]:
    objects: list[dict[str, Any]] = []
    for raw_payload in _JSON_LD_RE.findall(html):
        payload_text = raw_payload.strip()
        if not payload_text:
            continue
        try:
            parsed = json.loads(unescape(payload_text))
        except json.JSONDecodeError:
            continue
        objects.extend(_collect_jobposting_nodes(parsed))
    return objects


def normalize_job_url(url: str) -> str:
    parsed = urlparse(url.strip())
    filtered_query = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if key.lower() not in _TRACKING_QUERY_PARAMS and not key.lower().startswith("utm_")
    ]
    return urlunparse(
        (
            parsed.scheme,
            parsed.netloc,
            parsed.path.rstrip("/") or parsed.path,
            parsed.params,
            urlencode(filtered_query, doseq=True),
            "",
        )
    )


def _collect_jobposting_nodes(node: Any) -> list[dict[str, Any]]:
    if isinstance(node, list):
        collected: list[dict[str, Any]] = []
        for item in node:
            collected.extend(_collect_jobposting_nodes(item))
        return collected

    if not isinstance(node, dict):
        return []

    collected = []
    node_type = node.get("@type")
    if node_type == "JobPosting":
        collected.append(node)

    if isinstance(node_type, list) and "JobPosting" in node_type:
        collected.append(node)

    graph = node.get("@graph")
    if graph:
        collected.extend(_collect_jobposting_nodes(graph))
    return collected


def jobposting_to_record(
    payload: dict[str, Any],
    page_url: str,
    fallback_company: str,
    source_name: str,
) -> dict | None:
    if not is_active_jobposting(payload):
        return None

    title = _string_value(payload.get("title")) or _string_value(payload.get("name"))
    if not title:
        return None

    description_html = _string_value(payload.get("description"))
    company = _extract_company_name(payload) or fallback_company
    location = _extract_location(payload)
    salary_min, salary_max = _extract_salary_range(payload)

    return {
        "title": title,
        "company": company,
        "location": location,
        "description": strip_html(description_html or ""),
        "url": _string_value(payload.get("url")) or page_url,
        "source": source_name,
        "raw_html": json.dumps(payload, default=str),
        "salary_min": salary_min,
        "salary_max": salary_max,
    }


def is_active_jobposting(payload: dict[str, Any]) -> bool:
    valid_through = _parse_date(payload.get("validThrough"))
    if valid_through is None:
        return True
    return valid_through >= datetime.now(tz=timezone.utc)


def strip_html(html: str) -> str:
    text = _HTML_TAG_RE.sub(" ", html or "")
    return _normalize_space(unescape(text))


def extract_page_title(html: str) -> str:
    match = _TITLE_RE.search(html or "")
    if not match:
        return ""
    return _normalize_space(unescape(match.group(1)))


def extract_meta_tags(html: str) -> dict[str, str]:
    meta: dict[str, str] = {}
    for key, value in _META_RE.findall(html or ""):
        normalized_key = _normalize_space(key).lower()
        normalized_value = _normalize_space(unescape(value))
        if normalized_key and normalized_value and normalized_key not in meta:
            meta[normalized_key] = normalized_value
    return meta


def extract_readable_text(html: str) -> str:
    body_match = _BODY_RE.search(html or "")
    content = body_match.group(1) if body_match else (html or "")
    content = _SCRIPT_STYLE_RE.sub(" ", content)
    content = re.sub(r"<br\s*/?>", "\n", content, flags=re.IGNORECASE)
    content = re.sub(r"</(p|div|section|article|li|ul|ol|h[1-6])>", "\n", content, flags=re.IGNORECASE)
    content = strip_html(content)
    return _normalize_space(content)


def generic_page_to_record(
    html: str,
    page_url: str,
    fallback_company: str,
    source_name: str,
    title_hint: str = "",
    location_hint: str = "",
) -> dict | None:
    meta = extract_meta_tags(html)
    title = (
        _normalize_space(title_hint)
        or meta.get("og:title")
        or meta.get("twitter:title")
        or extract_page_title(html)
    )
    if not title:
        return None

    description = extract_readable_text(html)
    if len(description) < 200:
        meta_description = meta.get("description") or meta.get("og:description") or ""
        description = _normalize_space(f"{meta_description} {description}")

    if len(description) < 120:
        return None

    location = location_hint or ""
    if not location:
        location = _guess_location_from_text(description)

    return {
        "title": title,
        "company": fallback_company,
        "location": location,
        "description": description,
        "url": normalize_job_url(page_url),
        "source": source_name,
        "raw_html": json.dumps(
            {
                "page_url": normalize_job_url(page_url),
                "title": title,
                "meta_description": meta.get("description") or meta.get("og:description") or "",
            },
            default=str,
        ),
        "salary_min": None,
        "salary_max": None,
    }


def looks_like_job_link(url: str, text: str = "", company_domain: str = "") -> bool:
    parsed = urlparse(url)
    netloc = parsed.netloc.lower()
    path = parsed.path.lower()
    haystack = f"{path} {text.lower()} {url.lower()}"

    if company_domain:
        normalized_domain = company_domain.lower()
        same_company = netloc == normalized_domain or netloc.endswith(f".{normalized_domain}")
    else:
        same_company = True

    if same_company and _KEYWORD_RE.search(haystack):
        return True

    return any(host in netloc for host in _ATS_HOST_KEYWORDS) and _KEYWORD_RE.search(haystack) is not None


def extract_sitemap_urls(xml_bytes: bytes) -> list[str]:
    urls: list[str] = []
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return urls

    for loc in root.findall(".//{*}loc"):
        if loc.text:
            urls.append(loc.text.strip())
    return urls


def iter_workable_jobs(xml_bytes: bytes) -> list[dict[str, str]]:
    jobs: list[dict[str, str]] = []
    parser = ET.iterparse(BytesIO(xml_bytes), events=("end",))
    for _, elem in parser:
        if not elem.tag.endswith("job"):
            continue

        record: dict[str, str] = {}
        for child in list(elem):
            tag = child.tag.split("}")[-1]
            record[tag] = _normalize_space("".join(child.itertext()))
        jobs.append(record)
        elem.clear()

    return jobs


def _extract_company_name(payload: dict[str, Any]) -> str:
    hiring_org = payload.get("hiringOrganization")
    if isinstance(hiring_org, dict):
        return _string_value(hiring_org.get("name")) or ""
    if isinstance(hiring_org, list):
        for item in hiring_org:
            if isinstance(item, dict):
                name = _string_value(item.get("name"))
                if name:
                    return name
    return ""


def _extract_location(payload: dict[str, Any]) -> str:
    locations = payload.get("jobLocation")
    if isinstance(locations, list):
        parts = [_location_from_node(item) for item in locations]
        return ", ".join(part for part in parts if part)
    if isinstance(locations, dict):
        return _location_from_node(locations)

    applicant_location = payload.get("applicantLocationRequirements")
    if isinstance(applicant_location, dict):
        return _location_from_node(applicant_location)
    if isinstance(applicant_location, list):
        parts = [_location_from_node(item) for item in applicant_location]
        return ", ".join(part for part in parts if part)

    return ""


def _location_from_node(node: Any) -> str:
    if not isinstance(node, dict):
        return ""

    address = node.get("address")
    if isinstance(address, dict):
        parts = [
            _string_value(address.get("addressLocality")),
            _string_value(address.get("addressRegion")),
            _string_value(address.get("addressCountry")),
        ]
        joined = ", ".join(part for part in parts if part)
        if joined:
            return joined

    name = _string_value(node.get("name"))
    if name:
        return name
    return ""


def _extract_salary_range(payload: dict[str, Any]) -> tuple[int | None, int | None]:
    base_salary = payload.get("baseSalary")
    if not isinstance(base_salary, dict):
        return None, None

    value = base_salary.get("value")
    if isinstance(value, dict):
        minimum = _int_value(value.get("minValue"))
        maximum = _int_value(value.get("maxValue"))
        return minimum, maximum

    scalar = _int_value(value)
    return scalar, scalar


def _parse_date(value: Any) -> datetime | None:
    if not value:
        return None
    text = _string_value(value)
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        pass
    try:
        return parsedate_to_datetime(text).astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def _normalize_space(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", text.replace("\xa0", " ")).strip()


def _string_value(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _int_value(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(float(str(value)))
    except ValueError:
        return None


def _guess_location_from_text(text: str) -> str:
    lowered = text.lower()
    remote_markers = ("remote", "remote in us", "remote in usa", "us remote", "remote eligible")
    if any(marker in lowered for marker in remote_markers):
        return "Remote"

    labeled_patterns = (
        r"\bOffice locations?\s+(.{1,80}?)(?=\s+(?:Team|About|Who|Responsibilities|What|Qualifications|Role details)\b|$)",
        r"\bLocations?\s+(.{1,80}?)(?=\s+(?:Team|About|Who|Responsibilities|What|Qualifications|Role details)\b|$)",
    )
    for pattern in labeled_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if not match:
            continue
        value = _normalize_space(match.group(1))
        if value:
            return value
    return ""
