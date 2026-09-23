# -*- coding: utf-8 -*-
"""
Build the combined training set: the UCI SMS corpus plus recent public
smishing datasets, cleaned into one CSV with a `source` column.

    python build_dataset.py --download        # fetch pinned raw files, then build
    python build_dataset.py                   # build from files already in data/raw/

Output: data/combined.csv with columns label (ham/spam), message, source.

Sources (licences apply to the raw data, which is not committed):
  uci       UCI SMS Spam Collection (spam.csv in the repo root)       CC BY 4.0
  imc25     reportsmishing/Smishing-Dataset-IMC25, user reports       CC BY 4.0
  ncsu      wspr-ncsu/sms-phishing, gateway-collected phishing        MIT
  mendeley  Mendeley f45bkkt8pr SMS Phishing Dataset (smishing rows)  CC BY 4.0
  smishtank smishtank.com community submissions (manual download)     CC BY-NC-SA 4.0
            -> non-commercial use only; place the file at data/raw/smishtank.csv
  user      your own messages, prepared with scrub_messages.py -> data/raw/user_messages.csv
  feedback  app users' corrections, exported with export_feedback.py -> data/raw/feedback_messages.csv

None of the public sources contain modern *legitimate* messages (OTPs, bank
alerts, delivery updates); add real ones via scrub_messages.py.
"""

import argparse
import hashlib
import io
import random
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

import pandas as pd

from spamham_project_v3 import load_data, template_groups

RAW = Path("data/raw")
OUT = Path("data/combined.csv")
SEED = 42
# Scam feeds repeat one campaign hundreds of times with a different code or
# link; keep a few copies per template so no campaign dominates training.
MAX_PER_TEMPLATE = 2

DOWNLOADS = {
    "imc25.csv": (
        "https://raw.githubusercontent.com/reportsmishing/Smishing-Dataset-IMC25/"
        "a6175560b57387199871e51fbef6bc523d2516b4/dataset/final_dataset_output.csv",
        "1bbd1e9e82c3ea023112207b80da268a5c4a07d2353c2b0898360ab037fa9a64",
    ),
    "ncsu_messages.csv": (
        "https://raw.githubusercontent.com/wspr-ncsu/sms-phishing/"
        "a4f18cedc9909cbf8234eea3c2028080a1e95cd4/phishing_messages.csv",
        "d125c394af792faeb2b71b3f7100cad3b4cece02aff78cb4ec1fb9e7db90f230",
    ),
    "mendeley_5971.zip": (
        "https://data.mendeley.com/public-files/datasets/f45bkkt8pr/files/"
        "edb361de-918d-469f-9106-e84823830665/file_downloaded",
        "9bbf3188fdad81495d8e82825648b9b63b53fc86841a3d26c02629990b233cc3",
    ),
}

# Tiny stopword list for spotting English text in unlabelled-language sources.
ENGLISH_WORDS = set(
    "the a an to you your is are for of and on in at this that it be with has have "
    "will now please click here from our we us been can get not".split()
)


def download(dest_dir: Path):
    dest_dir.mkdir(parents=True, exist_ok=True)
    for name, (url, sha256) in DOWNLOADS.items():
        path = dest_dir / name
        if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == sha256:
            print(f"  {name}: already present")
            continue
        print(f"  {name}: downloading")
        # Mendeley rejects urllib's default User-Agent with 403.
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (build_dataset.py)"})
        try:
            with urllib.request.urlopen(request, timeout=120) as resp:
                data = resp.read()
        except OSError as exc:
            raise OSError(f"{name}: download from {url} failed ({exc})") from exc
        digest = hashlib.sha256(data).hexdigest()
        if digest != sha256:
            raise ValueError(f"{name}: checksum mismatch (got {digest}); the upstream file changed")
        path.write_bytes(data)


# --------------------------------------------------------------------------
# Placeholder replacement
#
# IMC25 masks personal data as <URL>, <PHONE_NUMBER>, ... Left in place, the
# model would learn the literal token "<URL>" as a fraud signal, which real
# messages never contain. Each placeholder becomes a random realistic value
# (seeded), so no single made-up string recurs often enough to be learnt.
# --------------------------------------------------------------------------
_rng = random.Random(SEED)
_TLDS = ["com", "net", "info", "top", "xyz", "co", "online", "site", "live", "app", "us", "uk"]


def _word(n_min=4, n_max=9):
    return "".join(_rng.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(_rng.randint(n_min, n_max)))


def _digits(n):
    return "".join(_rng.choice("0123456789") for _ in range(n))


def _fake_url():
    host = f"{_word()}-{_word(3, 6)}" if _rng.random() < 0.5 else _word()
    path = f"/{_word(3, 8)}" if _rng.random() < 0.7 else ""
    scheme = _rng.choice(["https://", "http://", ""])
    return f"{scheme}{host}.{_rng.choice(_TLDS)}{path}"


def _fake_date():
    return _rng.choice([
        f"{_rng.randint(1, 28)}/{_rng.randint(1, 12)}",
        f"{_rng.randint(1, 12)}:{_rng.randint(0, 59):02d}",
        _rng.choice(["today", "tomorrow", "24 hours", "Monday", "Friday"]),
    ])


PLACEHOLDERS = {
    "URL": _fake_url,
    "PHONE_NUMBER": lambda: "+1" + _digits(10) if _rng.random() < 0.5 else "0" + _digits(10),
    "EMAIL_ADDRESS": lambda: f"{_word()}@{_word()}.{_rng.choice(_TLDS)}",
    "DATE_TIME": _fake_date,
    "US_BANK_NUMBER": lambda: _digits(_rng.randint(8, 12)),
    "US_DRIVER_LICENSE": lambda: _word(1, 2).upper() + _digits(_rng.randint(5, 8)),
    "UK_NHS": lambda: _digits(10),
}


def fill_placeholders(text: str) -> str:
    def replace(match):
        maker = PLACEHOLDERS.get(match.group(1))
        # Names, places and other masked entities cannot be restored; drop them.
        return maker() if maker else ""

    text = re.sub(r"<([A-Z_]+)>", replace, text)
    return re.sub(r"\s+", " ", text).strip()


def looks_english(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    if not letters or sum(c.isascii() for c in letters) / len(letters) < 0.95:
        return False
    words = re.findall(r"[a-z]+", text.lower())
    return len(words) >= 3 and sum(w in ENGLISH_WORDS for w in words) / len(words) >= 0.15


# --------------------------------------------------------------------------
# Loaders: each returns a DataFrame with label, message, source
# --------------------------------------------------------------------------
def load_uci(path: Path) -> pd.DataFrame:
    df = load_data(path)[["label", "message"]]
    return df.assign(source="uci")


def load_imc25(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, low_memory=False)
    df = df[df["language"] == "English"]
    return pd.DataFrame({
        "label": "spam",
        "message": df["text"].astype(str).map(fill_placeholders),
        "source": "imc25",
    })


def load_ncsu(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, low_memory=False)
    # The published CSV's header is shifted one column: the SMS text sits
    # under "destination number".
    text = df["destination number"].dropna().astype(str).str.strip()
    text = text[text.map(looks_english)]
    return pd.DataFrame({"label": "spam", "message": text, "source": "ncsu"})


def load_mendeley(path: Path) -> pd.DataFrame:
    with zipfile.ZipFile(path) as zf:
        raw = zf.read("Dataset_5971.csv")
    try:
        df = pd.read_csv(io.BytesIO(raw), encoding="utf-8")
    except UnicodeDecodeError:
        df = pd.read_csv(io.BytesIO(raw), encoding="latin-1")
    # Only its smishing rows are new; its ham and spam are copies of UCI.
    df = df[df["LABEL"].str.lower() == "smishing"]
    return pd.DataFrame({"label": "spam", "message": df["TEXT"].astype(str).str.strip(),
                         "source": "mendeley"})


def load_smishtank(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path) if path.suffix == ".csv" else pd.read_json(path)
    col = next((c for c in df.columns if c.lower() in {"text", "message", "body", "message_body"}), None)
    if col is None:
        raise ValueError(f"{path}: no text column found in {list(df.columns)}")
    return pd.DataFrame({"label": "spam", "message": df[col].astype(str).str.strip(),
                         "source": "smishtank"})


def load_user(path: Path, source: str = "user") -> pd.DataFrame:
    df = pd.read_csv(path, dtype=str)
    if not {"label", "message"}.issubset(df.columns):
        raise ValueError(f"{path}: expected columns label,message (write it with scrub_messages.py)")
    bad = set(df["label"].unique()) - {"ham", "spam"}
    if bad:
        raise ValueError(f"{path}: unknown labels {sorted(bad)}; use ham or spam")
    return df[["label", "message"]].assign(source=source)


def _key(message: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", message.lower())


def build(uci_path: Path, raw: Path) -> pd.DataFrame:
    # Canonical and manually curated data win exact de-duplication. User
    # feedback is useful only when it does not conflict with a trusted label.
    parts = [load_uci(uci_path)]
    if (raw / "user_messages.csv").exists():
        parts.append(load_user(raw / "user_messages.csv"))
    if (raw / "feedback_messages.csv").exists():
        parts.append(load_user(raw / "feedback_messages.csv", source="feedback"))
    loaders = [
        ("imc25.csv", load_imc25),
        ("ncsu_messages.csv", load_ncsu),
        ("mendeley_5971.zip", load_mendeley),
        ("smishtank.csv", load_smishtank),
        ("smishtank.json", load_smishtank),
    ]
    for name, loader in loaders:
        path = raw / name
        if path.exists():
            parts.append(loader(path))
        elif not name.startswith("smishtank"):
            raise FileNotFoundError(f"{path} missing; run with --download")

    df = pd.concat(parts, ignore_index=True)
    trusted = df["source"].isin(["uci", "user", "feedback"])
    minimum_length = df["message"].str.len() >= 5
    dropped_short_public = int((~trusted & ~minimum_length).sum())
    if dropped_short_public:
        print(f"Dropped {dropped_short_public} very short public-source messages")
    df = df[trusted | minimum_length]

    # Conflicting labels are unsafe to resolve by source order: any registered
    # account could otherwise poison a canonical example. Quarantine the whole
    # conflict for manual review rather than silently trusting either label.
    df = df.assign(_key=df["message"].map(_key))
    conflicts = df.groupby("_key", sort=False)["label"].nunique()
    conflict_keys = conflicts[conflicts > 1].index
    if len(conflict_keys):
        print(f"Quarantined {int(df['_key'].isin(conflict_keys).sum())} rows with conflicting labels.")
        df = df[~df["_key"].isin(conflict_keys)]

    # De-duplicate across sources on letters/digits only. UCI rows are first,
    # so a known canonical label is never silently replaced by user feedback.
    df = df.drop_duplicates("_key").drop(columns="_key")

    new = df["source"] != "uci"
    capped = (df[new].assign(_t=template_groups(df.loc[new, "message"]))
              .groupby("_t", sort=False).head(MAX_PER_TEMPLATE).drop(columns="_t"))
    print(f"Capped repeated non-UCI campaigns: {int(new.sum())} -> {len(capped)} messages")
    return pd.concat([df[~new], capped], ignore_index=True)


def main():
    parser = argparse.ArgumentParser(description="Build the combined SMS fraud dataset")
    parser.add_argument("--download", action="store_true", help="fetch the pinned raw files first")
    parser.add_argument("--uci", type=Path, default=Path("spam.csv"))
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()

    try:
        if args.download:
            download(RAW)
        df = build(args.uci, RAW)
    except (FileNotFoundError, ValueError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    args.out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out, index=False, encoding="utf-8")
    print(f"\nWrote {len(df)} messages to {args.out}")
    print(df.groupby(["source", "label"]).size().to_string())
    return 0


if __name__ == "__main__":
    sys.exit(main())
