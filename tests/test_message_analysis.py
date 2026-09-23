from message_analysis import LINK_WARNING_ACTION, RECOMMENDED_ACTIONS, recommended_action

BRAND_LINK = {"category": "link_risk", "severity": "high", "name": "Link Imitates a Known Brand"}
RISKY_TLD = {"category": "link_risk", "severity": "medium", "name": "Frequently Abused Domain Ending"}


def test_low_score_with_dangerous_link_warns():
    assert recommended_action("LOW", [BRAND_LINK]) is LINK_WARNING_ACTION


def test_low_score_without_dangerous_link_is_normal():
    assert recommended_action("LOW", [RISKY_TLD]) is RECOMMENDED_ACTIONS["LOW"]


def test_fraud_verdicts_keep_their_action():
    assert recommended_action("HIGH", [BRAND_LINK]) is RECOMMENDED_ACTIONS["HIGH"]
    assert recommended_action("MEDIUM", [BRAND_LINK]) is RECOMMENDED_ACTIONS["MEDIUM"]
