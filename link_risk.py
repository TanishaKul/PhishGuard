# -*- coding: utf-8 -*-
"""
Offline risk checks for links in a message: brand lookalikes, shorteners,
IP-address hosts, punycode and commonly abused top-level domains.

These are explainable rule signals shown next to the model's score; they do
not change the score. No network lookups are made.
"""

import ipaddress
import re
from urllib.parse import urlsplit

# Match a complete URL authority first so userinfo (user@host) cannot be
# mistaken for the real destination. Bare domains and bracketed IPv6 hosts are
# retained for offline analysis.
LINK_RE = re.compile(
    r"(?ix)"
    r"(?:(?:https?://|www\.)[^\s<>\"']+"
    r"|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}(?::\d+)?(?:/[^\s<>\"']*)?"
    r"|\[[0-9a-f:]+\](?::\d+)?(?:/[^\s<>\"']*)?"
    r"|\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:/[^\s<>\"']*)?)"
)

SHORTENERS = {
    "bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd", "cutt.ly", "rb.gy", "tiny.cc",
    "ow.ly", "shorturl.at", "s.id", "rebrand.ly", "buff.ly", "t.ly", "v.gd",
}

# TLDs heavily over-represented in phishing reports; a hint, not proof.
RISKY_TLDS = {
    "top", "xyz", "info", "live", "icu", "click", "cfd", "sbs", "cc", "tk", "ml", "ga", "cf",
    "gq", "buzz", "rest", "bond", "cyou", "vip", "shop", "online", "site", "support", "work",
}

# Brand keyword -> registrable domains the brand really uses.
BRANDS = {
    "paypal": {"paypal.com", "paypal.me"},
    "amazon": {"amazon.com", "amazon.in", "amazon.co.uk", "amazon.de", "amzn.to", "amazon.ca"},
    "usps": {"usps.com"},
    "fedex": {"fedex.com"},
    "dhl": {"dhl.com", "dhl.de", "dhl.co.uk"},
    "royalmail": {"royalmail.com"},
    "evri": {"evri.com"},
    "hdfc": {"hdfcbank.com", "hdfc.com"},
    "sbi": {"onlinesbi.sbi", "sbi.co.in", "sbicard.com"},
    "icici": {"icicibank.com"},
    "apple": {"apple.com", "icloud.com"},
    "netflix": {"netflix.com"},
    "microsoft": {"microsoft.com", "live.com", "office.com"},
    "google": {"google.com", "g.co"},
    "chase": {"chase.com"},
    "wellsfargo": {"wellsfargo.com"},
    "bankofamerica": {"bankofamerica.com"},
    "hsbc": {"hsbc.com", "hsbc.co.uk", "hsbc.co.in"},
    "barclays": {"barclays.co.uk", "barclays.com"},
    "ezpass": {"e-zpassny.com", "ezpassnj.com", "ezpassva.com", "e-zpassiag.com"},
    "irs": {"irs.gov"},
    "hmrc": {"gov.uk"},
    "whatsapp": {"whatsapp.com", "wa.me"},
}

# Digits commonly swapped for letters in lookalike domains (paypa1, amaz0n).
_LEET = str.maketrans({"0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t"})
_SECOND_LEVEL = {"co", "com", "org", "net", "gov", "ac", "edu"}


def registrable_domain(host: str) -> str:
    """example.co.uk from a.b.example.co.uk (approximate; no public-suffix list)."""
    labels = host.lower().rstrip(".").split(".")
    if len(labels) >= 3 and len(labels[-1]) == 2 and labels[-2] in _SECOND_LEVEL:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def _signal(kind, name, severity, evidence, explanation):
    return {"id": f"sig-link-{kind}-{evidence}", "name": name, "category": "link_risk",
            "evidence": evidence, "severity": severity, "explanation": explanation}


def _extract_hosts(message: str) -> list[str]:
    hosts = []
    for match in LINK_RE.finditer(message):
        candidate = match.group(0).rstrip(".,;:!?)]}")
        parsed_value = candidate if "://" in candidate else f"//{candidate}"
        try:
            host = urlsplit(parsed_value).hostname
        except ValueError:
            continue
        if host:
            hosts.append(host.lower().rstrip("."))
    return list(dict.fromkeys(hosts))


def _extract_userinfo(message: str) -> list[str]:
    userinfos = []
    for match in LINK_RE.finditer(message):
        candidate = match.group(0).rstrip(".,;:!?)]}")
        if "://" not in candidate:
            continue
        try:
            username = urlsplit(candidate).username
        except ValueError:
            continue
        if username:
            userinfos.append(username.lower())
    return list(dict.fromkeys(userinfos))


def _is_ip_host(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        pass
    if re.fullmatch(r"0x[0-9a-f]+", host):
        return True
    if host.isdigit():
        try:
            return 0 <= int(host) <= 2**32 - 1
        except ValueError:
            return False
    return False


def link_signals(message: str) -> list[dict]:
    signals = []
    for userinfo in _extract_userinfo(message):
        squashed = re.sub(r"[^a-z0-9]", "", userinfo)
        for brand in BRANDS:
            if (brand in squashed if len(brand) >= 5 else squashed.startswith(brand)):
                signals.append(_signal(
                    "userinfo", "Brand Name Hidden Before the Real Host", "high", userinfo,
                    f"The URL displays {userinfo} before @, but browsers connect to the host after @.",
                ))
                break
    for host in _extract_hosts(message):
        if _is_ip_host(host):
            signals.append(_signal("ip", "Link Uses a Raw IP Address", "high", host,
                                   "Legitimate services link to named domains, not bare IP addresses."))
            continue
        domain = registrable_domain(host)
        tld = domain.rsplit(".", 1)[-1]
        # "name.hsbc" in a signature is not a link; real TLDs are never brand names here.
        if tld.isdigit() or len(tld) < 2 or tld in BRANDS:
            continue

        if "xn--" in host:
            signals.append(_signal("punycode", "Disguised Characters in Link", "high", host,
                                   "Punycode lets a domain use lookalike letters from other alphabets."))
        if domain in SHORTENERS:
            signals.append(_signal("short", "Shortened Link", "medium", host,
                                   "Link shorteners hide the real destination."))

        tokens = [t.translate(_LEET) for t in re.split(r"[.-]", host)]
        squashed = "".join(tokens)
        for brand, official in BRANDS.items():
            # Short names ("irs", "sbi") must start a label part, so "first.com" is not "irs".
            found = brand in squashed if len(brand) >= 5 else any(t.startswith(brand) for t in tokens)
            if found and domain not in official:
                signals.append(_signal("brand", "Link Imitates a Known Brand", "high", host,
                                       f"Mentions {brand} but is not one of its official domains "
                                       f"({', '.join(sorted(official))})."))
                break

        if tld in RISKY_TLDS:
            signals.append(_signal("tld", "Frequently Abused Domain Ending", "medium", host,
                                   f".{tld} domains are common in phishing campaigns."))
    return signals
