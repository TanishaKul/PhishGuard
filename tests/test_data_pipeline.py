import pandas as pd

import build_dataset
import spamham_project_v3 as sp
from scrub_messages import scrub


def test_indexed_uci_csv_is_not_treated_as_spilled_text(tmp_path):
    path = tmp_path / "indexed.csv"
    pd.DataFrame({"v1": ["ham"], "v2": ["hello there"]}).to_csv(path, index=True)

    loaded = sp.load_data(path)

    assert loaded.iloc[0]["message"] == "hello there"


def test_campaign_grouping_normalizes_complete_bare_domain_links():
    messages = pd.Series([
        "HDFC KYC pending verify at hdfc-kyc.in/one",
        "HDFC KYC pending verify at hdfc-kyc.in/two",
    ])

    assert sp.template_groups(messages).nunique() == 1


def test_scrubber_removes_url_userinfo_and_formula_prefix():
    scrubbed = scrub("=HYPERLINK(\"https://example.com\") https://alice:secret@example.com/path?token=AbC123")

    assert scrubbed.startswith("'=")
    assert "alice" not in scrubbed
    assert "secret" not in scrubbed
    assert "AbC123" not in scrubbed
    assert "example.com" in scrubbed


def test_conflicting_feedback_is_quarantined_instead_of_overriding(tmp_path, monkeypatch):
    uci = tmp_path / "spam.csv"
    raw = tmp_path / "raw"
    raw.mkdir()
    pd.DataFrame({"v1": ["spam"], "v2": ["canonical fraud message"]}).to_csv(uci, index=False)
    pd.DataFrame({"label": ["ham"], "message": ["canonical fraud message"]}).to_csv(
        raw / "feedback_messages.csv", index=False
    )
    for filename in ("imc25.csv", "ncsu_messages.csv", "mendeley_5971.zip"):
        (raw / filename).write_text("fixture")
    empty = pd.DataFrame(columns=["label", "message", "source"])
    monkeypatch.setattr(build_dataset, "load_imc25", lambda path: empty)
    monkeypatch.setattr(build_dataset, "load_ncsu", lambda path: empty)
    monkeypatch.setattr(build_dataset, "load_mendeley", lambda path: empty)

    combined = build_dataset.build(uci, raw)

    assert combined.empty
