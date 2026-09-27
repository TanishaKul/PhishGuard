# -*- coding: utf-8 -*-
"""
Per-message analysis served by api_server.py: model verdict, the model's own
feature contributions, rule-based signals and a recommended action.

The rules live here and in spamham_project_v3.py only; the frontend renders
what this returns and keeps no copy of them.
"""

import time
from datetime import datetime
from zoneinfo import ZoneInfo

import spamham_project_v3 as sp
from link_risk import link_signals

IST = ZoneInfo("Asia/Kolkata")

SIGNAL_SPECS = {
    "urgency": (
        "Psychological Coercion (Urgency)", "high",
        "Artificial deadlines induce panic to impair victim caution.",
    ),
    "account_threat": (
        "Account Lockout / Deactivation Threat", "high",
        "Impersonates institutional security warnings to provoke credential entry.",
    ),
    "financial": (
        "Financial Incentive / Payment Hook", "medium",
        "Unsolicited refund, bank notice, or money transfer lure.",
    ),
    "reward_scam": (
        "Prize / Sweepstakes Bait", "high",
        "Promises of unearned rewards to trick the user into paying release fees.",
    ),
    "action_request": (
        "Compulsory Call-to-Action", "medium",
        "Direct command urging the recipient to click or authenticate.",
    ),
}

ENTITY_SPECS = [
    ("entity_url", sp.URL_RE, "Unverified External Hyperlink", "high",
     "Smishing messages direct victims to spoofed credential-harvesting websites."),
    ("entity_shortcode", sp.SHORTCODE_RE, "Standalone Numeric Code", "low",
     "A standalone 4–6 digit code may be an OTP, transaction reference or premium shortcode; context is required."),
    ("entity_currency", sp.CURRENCY_RE, "Monetary / Currency Token", "medium",
     "Financial baiting using monetary figures is common in prize/refund scams."),
    ("entity_email", sp.EMAIL_RE, "Embedded Contact Email", "low",
     "Embedded email address used for off-platform communication."),
    ("entity_phone", sp.PHONE_RE, "Callback Telephone Number", "medium",
     "Voice phishing lures instruct targets to call rogue call centers."),
]

RECOMMENDED_ACTIONS = {
    "HIGH": {
        "action": "BLOCK SENDER & QUARANTINE",
        "badge": "High Fraud Risk",
        "description": "High probability smishing attempt. Do not click links, reply, "
                       "or provide any credentials or OTP codes.",
        "severity": "red",
        "steps": [
            "Do not click any embedded links or open attachments.",
            "Block the originating telephone number / shortcode on your device.",
            "Report the message to your carrier (in the US/UK, forward it to 7726).",
            "If credentials were entered, reset your bank/account passwords immediately.",
        ],
    },
    "MEDIUM": {
        "action": "FLAG FOR REVIEW & VERIFY MANUALLY",
        "badge": "Elevated Risk Warning",
        "description": "Scored above the fraud threshold but below high confidence. "
                       "Treat as suspicious until verified.",
        "severity": "amber",
        "steps": [
            "Verify the sender through an official channel (not contact info in the SMS).",
            "Inspect any URL domain carefully for typosquatting.",
            "Do not reply to the message to 'check' whether the sender is real.",
        ],
    },
    "LOW": {
        "action": "NO ACTION NEEDED",
        "badge": "Below Fraud Threshold",
        "description": "The model scored this below its fraud threshold. Models miss new scam "
                       "styles, so stay cautious with unexpected requests.",
        "severity": "green",
        "steps": [
            "Normal handling.",
            "Still never share OTP codes or passwords over SMS.",
        ],
    },
}


# Shown instead of "no action" when the model scores a message low but one of
# its links looks dangerous. The model's verdict and score are unchanged.
LINK_WARNING_ACTION = {
    "action": "CHECK THE LINK BEFORE TRUSTING",
    "badge": "Risky Link Despite Low Score",
    "description": "The model scored this message low, but a link in it looks dangerous "
                   "(see Detected Threat Signals).",
    "severity": "amber",
    "steps": [
        "Do not open the link; go to the company's site or app directly instead.",
        "Never enter passwords, card details or OTP codes from an SMS link.",
        "If unsure, report the result as wrong so the model can learn from it.",
    ],
}


def recommended_action(risk_level, signals):
    risky_link = any(s["category"] == "link_risk" and s["severity"] == "high" for s in signals)
    if risk_level == "LOW" and risky_link:
        return LINK_WARNING_ACTION
    return RECOMMENDED_ACTIONS[risk_level]


def detected_signals(message, keywords):
    signals = []
    for category, pattern, name, severity, explanation in ENTITY_SPECS:
        match = pattern.search(message)
        if match:
            signals.append({
                "id": f"sig-{category}", "name": name, "category": category,
                "evidence": match.group(0), "severity": severity, "explanation": explanation,
            })

    for category, matches in keywords.items():
        name, severity, explanation = SIGNAL_SPECS[category]
        signals.append({
            "id": f"sig-{category}", "name": name, "category": category,
            "evidence": ", ".join(matches), "severity": severity, "explanation": explanation,
        })

    signals.extend(link_signals(message))

    exclaims = message.count("!")
    if exclaims >= 2:
        signals.append({
            "id": "sig-exclamation", "name": "Elevated Exclamation Density",
            "category": "exclamation", "evidence": f"{exclaims} exclamation marks",
            "severity": "low", "explanation": "High punctuation density correlates with spam urgency.",
        })
    return signals


def model_features(message):
    """The handcrafted features and tokens exactly as the model computes them."""
    values = dict(zip(sp.HandcraftedFeatures.feature_names,
                      sp.HandcraftedFeatures._features(message)))
    lowered = message.lower()
    return {
        "wordTokens": sp.normalize_text(message).split()[:12],
        "charNgrams": [lowered[i:i + 3] for i in range(min(len(lowered) - 2, 8))],
        "charCount": int(values["n_chars"]),
        "wordCount": int(values["n_words"]),
        "upperRatio": round(values["upper_ratio"], 4),
        "digitRatio": round(values["digit_ratio"], 4),
        "punctRatio": round(values["punct_ratio"], 4),
        "exclaimCount": int(values["n_exclaim"]),
        "hasUrl": bool(values["has_url"]),
        "hasEmail": bool(values["has_email"]),
        "hasPhone": bool(values["has_phone"]),
        "hasCurrency": bool(values["has_currency"]),
        # Backward-compatible model feature name. The trained pipeline counts
        # all suspicious keyword categories here, so the UI also receives the
        # correctly named counts below instead of labelling this as urgency.
        "urgencyTermsCount": int(values["n_urgency_terms"]),
        "urgencyKeywordCount": len(sp.detect_suspicious_keywords(message).get("urgency", [])),
        "suspiciousKeywordCount": sum(
            len(matches) for matches in sp.detect_suspicious_keywords(message).values()
        ),
    }


def analyze(pipeline, message, threshold, index=None):
    start = time.perf_counter()
    probability = float(pipeline.predict_proba([message])[0][1])
    risk_level = sp.get_risk_level(probability, threshold)
    keywords = sp.detect_suspicious_keywords(message)
    contributions = sp.term_contributions(pipeline, message, index=index)
    signals = detected_signals(message, keywords)
    latency = round((time.perf_counter() - start) * 1000, 2)

    return {
        "id": f"scan-{int(time.time() * 1000)}",
        "message": message,
        "prediction": "FRAUD" if probability >= threshold else "LEGITIMATE",
        "probability": round(probability, 4),
        "riskScore": round(probability * 100, 1),
        "riskLevel": risk_level,
        "threshold": threshold,
        "reasons": sp.explain_prediction(message),
        "detectedCategories": list(keywords),
        "detectedSignals": signals,
        "modelFeatures": model_features(message),
        "modelContributions": contributions,
        "recommendedAction": recommended_action(risk_level, signals),
        "timestamp": datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S"),
        "latencyMs": latency,
    }
