import pytest

from link_risk import link_signals, registrable_domain


def names(message):
    return {s["name"] for s in link_signals(message)}


@pytest.mark.parametrize("host, expected", [
    ("a.b.example.com", "example.com"),
    ("secure.hsbc.co.uk", "hsbc.co.uk"),
    ("amazon.in", "amazon.in"),
])
def test_registrable_domain(host, expected):
    assert registrable_domain(host) == expected


@pytest.mark.parametrize("message", [
    "HDFC Bank: KYC pending. Verify at hdfc-kyc.in",
    "USPS: update address at usps-redelivery-help.com",
    "Your PayPal is limited, log in at paypa1-secure.net/login",
    "Unpaid toll: pay at ezpass-pay.top",
])
def test_brand_lookalikes_flagged(message):
    assert "Link Imitates a Known Brand" in names(message)


@pytest.mark.parametrize("message", [
    "Your Amazon order has shipped: https://www.amazon.in/gp/your-account",
    "Sign in at https://www.hdfcbank.com to view your statement",
    "Track your parcel at https://tools.usps.com/go/TrackConfirmAction",
    "Meeting notes are on first.com and the agenda is on example.org",
    "See you at 6. Bring the u.s. maps",
    "Sorry sir, i will call you tomorrow.  senthil.hsbc",
])
def test_official_and_unrelated_links_not_flagged(message):
    assert names(message) == set()


def test_other_link_signals():
    assert "Shortened Link" in names("Claim now: bit.ly/3xYz")
    assert "Link Uses a Raw IP Address" in names("Login at http://192.168.10.5/bank")
    assert "Link Uses a Raw IP Address" in names("Login at http://2130706433/bank")
    assert "Link Uses a Raw IP Address" in names("Login at http://[::1]/bank")
    assert "Disguised Characters in Link" in names("Visit xn--pypal-4ve.com now")
    assert "Frequently Abused Domain Ending" in names("Prize waiting at winbig.xyz")


def test_url_userinfo_cannot_hide_real_host():
    assert "Brand Name Hidden Before the Real Host" in names(
        "Sign in at https://paypal.com@evil.net/login"
    )


def test_each_host_reported_once():
    signals = link_signals("bit.ly/a then bit.ly/b")
    assert [s["name"] for s in signals] == ["Shortened Link"]
