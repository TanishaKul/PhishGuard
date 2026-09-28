import json
import os
import re

import joblib
import pytest
from fastapi.testclient import TestClient
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

import mailer
import spamham_project_v3 as sp
from api_server import MAX_BODY_BYTES, MAX_MESSAGE_CHARS, create_app, public_model_report
from db import Base, Database

FRAUD = [
    "URGENT! Your account has been blocked. Click here to verify immediately http://bit.ly/x",
    "Congratulations! You won a free prize. Claim now at www.win-prize.com",
    "Your package is on hold. Update your address at usps-help.top today",
    "Final notice: unpaid toll of $4.15. Pay now at ezpass-pay.xyz to avoid a fee",
    "Bank alert: suspicious login. Confirm your account at secure-bank.info now",
    "You have been selected for a $500 reward. Call 09061701461 to claim",
]
LEGIT = [
    "Hey, are we still meeting at 6 pm today?",
    "Ok see you later, I'm going home now",
    "Thanks for dinner last night, it was lovely",
    "Can you pick up milk on the way back?",
    "Sorry I missed your call, will ring you tomorrow",
    "Good luck with the exam, let me know how it goes",
]
PASSWORD = "correct horse battery"


@pytest.fixture(scope="session")
def model_path(tmp_path_factory):
    pipe = Pipeline([("features", sp.build_features()), ("clf", LogisticRegression(max_iter=1000))])
    # min_df in the vectorizers needs a few repeats of each message.
    pipe.fit((FRAUD + LEGIT) * 3, ([1] * len(FRAUD) + [0] * len(LEGIT)) * 3)
    path = tmp_path_factory.mktemp("model") / "model.joblib"
    report = {"metrics": {"modelName": "test-lr", "threshold": 0.5}}
    joblib.dump({"pipeline": pipe, "threshold": 0.5, "model_name": "test-lr", "report": report}, path)
    return path


@pytest.fixture
def database(tmp_path):
    # Set TEST_DATABASE_URL to run against Postgres; tables are reset per test.
    url = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{tmp_path}/test.db"
    db = Database(url)
    Base.metadata.drop_all(db.engine)
    with db.engine.begin() as conn:
        conn.exec_driver_sql("DROP TABLE IF EXISTS alembic_version")
    yield db
    db.engine.dispose()


@pytest.fixture
def client(model_path, database):
    app = create_app(model_path=model_path, database=database, extra_origins=[], cookie_secure=False)
    with TestClient(app) as c:
        yield c


def register(client, email="user@example.com", password=PASSWORD):
    return client.post("/api/auth/register", json={"email": email, "password": password})


def test_health_and_metrics_are_public(client):
    assert client.get("/api/health").json()["model"] == "test-lr"
    assert client.get("/api/metrics").json()["metrics"]["modelName"] == "test-lr"


def test_missing_model_returns_503(tmp_path):
    app = create_app(model_path=tmp_path / "nope.joblib", database=Database(f"sqlite:///{tmp_path}/t.db"),
                     extra_origins=[], cookie_secure=False)
    with TestClient(app) as c:
        r = c.get("/api/health")
        assert r.status_code == 503 and "not found" in r.json()["error"]
        register(c)
        r = c.post("/api/scan", json={"message": "hi there"})
        assert r.status_code == 503 and "python spamham_project_v3.py" in r.json()["hint"]


def test_scan_requires_sign_in(client):
    r = client.post("/api/scan", json={"message": "hello"})
    assert r.status_code == 401
    assert r.json()["error"] == "You are not signed in."


def test_register_login_logout(client):
    assert register(client).status_code == 201
    assert client.get("/api/auth/me").json() == {"email": "user@example.com", "isAdmin": False}

    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").status_code == 401

    r = client.post("/api/auth/login", json={"email": "USER@example.com ", "password": PASSWORD})
    assert r.status_code == 200
    assert client.get("/api/auth/me").status_code == 200


def test_session_cookie_is_http_only(client):
    cookie = register(client).headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie


def test_password_is_hashed(client, database):
    register(client)
    with database.engine.connect() as conn:
        stored = conn.exec_driver_sql("select password_hash from users").scalar()
    assert stored.startswith("scrypt$") and PASSWORD not in stored


@pytest.mark.parametrize("body, message", [
    ({"email": "not-an-email", "password": PASSWORD}, "valid email"),
    ({"email": "a@b.co", "password": "short"}, "at least 8"),
    ({"email": "a@b.co"}, "'password' is required"),
])
def test_register_validation(client, body, message):
    r = client.post("/api/auth/register", json=body)
    assert r.status_code == 400 and message in r.json()["error"]


def test_duplicate_email_is_409(client):
    register(client)
    client.cookies.clear()
    r = register(client, email="User@Example.com")
    assert r.status_code == 409


def test_wrong_password_then_rate_limited(client):
    register(client)
    client.cookies.clear()
    bad = {"email": "user@example.com", "password": "wrong password"}
    for _ in range(5):
        assert client.post("/api/auth/login", json=bad).status_code == 401
    r = client.post("/api/auth/login", json={"email": "user@example.com", "password": PASSWORD})
    assert r.status_code == 429 and "Retry-After" in r.headers


def test_unknown_email_gives_same_error(client):
    r = client.post("/api/auth/login", json={"email": "ghost@example.com", "password": PASSWORD})
    assert r.status_code == 401 and r.json()["error"] == "Email or password is incorrect."


def test_scan_saves_to_history(client):
    register(client)
    r = client.post("/api/scan", json={"message": FRAUD[0]})
    assert r.status_code == 200
    result = r.json()
    assert result["prediction"] in {"FRAUD", "LEGITIMATE"}
    assert {"modelContributions", "detectedSignals", "recommendedAction"} <= result.keys()

    history = client.get("/api/history").json()
    assert history["total"] == 1
    assert history["items"][0]["id"] == result["id"]
    assert history["items"][0]["result"]["probability"] == result["probability"]


def test_history_is_per_user(client):
    register(client, email="a@example.com")
    client.post("/api/scan", json={"message": FRAUD[1]})
    client.cookies.clear()
    register(client, email="b@example.com")
    assert client.get("/api/history").json()["total"] == 0


def test_delete_history(client):
    register(client)
    scan_id = client.post("/api/scan", json={"message": LEGIT[0]}).json()["id"].removeprefix("scan-")
    client.post("/api/scan", json={"message": LEGIT[1]})
    assert client.delete(f"/api/history/{scan_id}").json() == {"deleted": 1}
    assert client.delete(f"/api/history/{scan_id}").status_code == 404
    assert client.delete("/api/history").json() == {"deleted": 1}
    assert client.get("/api/history").json()["total"] == 0


@pytest.mark.parametrize("kwargs, status, message", [
    ({"content": "{bad", "headers": {"Content-Type": "application/json"}}, 400, "not valid JSON"),
    ({"json": {"message": "   "}}, 400, "empty"),
    ({"json": {"message": 123}}, 400, "'message'"),
    ({"json": [1]}, 400, "JSON object"),
    ({"json": {"message": "hi", "threshold": "abc"}}, 400, "'threshold'"),
    ({"json": {"message": "hi", "threshold": 5}}, 400, "between 0 and 1"),
    ({"json": {"message": "a" * (MAX_MESSAGE_CHARS + 1)}}, 413, "limit is 5000"),
    ({"content": "hello", "headers": {"Content-Type": "text/plain"}}, 415, "text/plain"),
])
def test_scan_input_errors(client, kwargs, status, message):
    register(client)
    r = client.post("/api/scan", **kwargs)
    assert r.status_code == status, r.text
    assert message in r.json()["error"]


def test_oversized_body_is_413(client):
    register(client)
    body = json.dumps({"message": "a" * (MAX_BODY_BYTES + 10)})
    r = client.post("/api/scan", content=body, headers={"Content-Type": "application/json"})
    assert r.status_code == 413 and "bytes" in r.json()["error"]


def test_cors_only_allows_localhost(client):
    ok = client.get("/api/health", headers={"Origin": "http://localhost:3001"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:3001"
    assert ok.headers.get("access-control-allow-credentials") == "true"
    evil = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in evil.headers
    mutation = client.post("/api/auth/logout", headers={"Origin": "https://evil.example"})
    assert mutation.status_code == 403


def test_unknown_route_is_404(client):
    r = client.get("/api/nope")
    assert r.status_code == 404 and "/api/nope" in r.json()["error"]


def scan_id(client, message=FRAUD[0]):
    return client.post("/api/scan", json={"message": message}).json()["id"].removeprefix("scan-")


def test_feedback_roundtrip(client):
    register(client)
    sid = scan_id(client)
    r = client.post(f"/api/scans/{sid}/feedback", json={"correctLabel": "legit", "note": " my bank "})
    assert r.status_code == 200 and r.json() == {"scanId": f"scan-{sid}", "correctLabel": "legit", "note": "my bank"}
    # Resubmitting replaces the earlier verdict.
    client.post(f"/api/scans/{sid}/feedback", json={"correctLabel": "fraud"})
    item = client.get("/api/history").json()["items"][0]
    assert item["feedback"] == "fraud" and item["result"]["feedback"] == "fraud"
    assert client.delete(f"/api/scans/{sid}/feedback").json() == {"deleted": 1}
    assert client.get("/api/history").json()["items"][0]["feedback"] is None


@pytest.mark.parametrize("body, status, message", [
    ({"correctLabel": "maybe"}, 400, "'correctLabel'"),
    ({}, 400, "'correctLabel' is required"),
    ({"correctLabel": "legit", "note": "x" * 501}, 413, "limit is 500"),
])
def test_feedback_validation(client, body, status, message):
    register(client)
    r = client.post(f"/api/scans/{scan_id(client)}/feedback", json=body)
    assert r.status_code == status and message in r.json()["error"]


def test_feedback_only_on_own_scans(client):
    register(client, email="a@example.com")
    sid = scan_id(client)
    client.cookies.clear()
    register(client, email="b@example.com")
    r = client.post(f"/api/scans/{sid}/feedback", json={"correctLabel": "legit"})
    assert r.status_code == 404


class Outbox:
    def __init__(self):
        self.sent = []

    def send(self, to, subject, body):
        self.sent.append((to, subject, body))

    def token(self):
        return re.search(r"token=(\S+)", self.sent[-1][2]).group(1)


@pytest.fixture
def outbox():
    return Outbox()


@pytest.fixture
def reset_client(model_path, database, outbox):
    app = create_app(model_path=model_path, database=database, extra_origins=[], cookie_secure=False,
                     mail=outbox, app_url="http://app.test")
    with TestClient(app) as c:
        yield c


def test_password_reset_flow(reset_client, outbox):
    c = reset_client
    register(c)
    other_session = c.cookies.get("pg_session")
    c.cookies.clear()

    r = c.post("/api/auth/forgot", json={"email": "USER@example.com"})
    assert r.status_code == 202 and "If an account exists" in r.json()["message"]
    assert outbox.sent[-1][0] == "user@example.com" and "http://app.test/reset-password#token=" in outbox.sent[-1][2]

    r = c.post("/api/auth/reset", json={"token": outbox.token(), "password": "a brand new password"})
    assert r.status_code == 200 and c.get("/api/auth/me").status_code == 200
    # Old sessions are signed out, the old password no longer works, the new one does.
    c.cookies.clear()
    c.cookies.set("pg_session", other_session)
    assert c.get("/api/auth/me").status_code == 401
    c.cookies.clear()
    assert c.post("/api/auth/login", json={"email": "user@example.com", "password": PASSWORD}).status_code == 401
    assert c.post("/api/auth/login", json={"email": "user@example.com", "password": "a brand new password"}).status_code == 200


def test_reset_token_is_single_use(reset_client, outbox):
    register(reset_client)
    reset_client.post("/api/auth/forgot", json={"email": "user@example.com"})
    token = outbox.token()
    assert reset_client.post("/api/auth/reset", json={"token": token, "password": "new password 1"}).status_code == 200
    r = reset_client.post("/api/auth/reset", json={"token": token, "password": "new password 2"})
    assert r.status_code == 400 and "invalid or has expired" in r.json()["error"]


def test_reset_rejects_bad_token_and_short_password(reset_client, outbox):
    register(reset_client)
    assert reset_client.post("/api/auth/reset", json={"token": "nope", "password": "long enough"}).status_code == 400
    reset_client.post("/api/auth/forgot", json={"email": "user@example.com"})
    r = reset_client.post("/api/auth/reset", json={"token": outbox.token(), "password": "short"})
    assert r.status_code == 400 and "at least 8" in r.json()["error"]


def test_forgot_unknown_email_looks_the_same(reset_client, outbox):
    r = reset_client.post("/api/auth/forgot", json={"email": "ghost@example.com"})
    assert r.status_code == 202 and outbox.sent == []


def test_forgot_is_rate_limited(reset_client):
    for _ in range(3):
        assert reset_client.post("/api/auth/forgot", json={"email": "x@example.com"}).status_code == 202
    assert reset_client.post("/api/auth/forgot", json={"email": "x@example.com"}).status_code == 429


def test_forgot_does_not_reveal_mail_failure(model_path, database):
    class Broken:
        def send(self, *a):
            raise mailer.MailError("smtp down")

    app = create_app(model_path=model_path, database=database, extra_origins=[], cookie_secure=False, mail=Broken())
    with TestClient(app) as c:
        register(c)
        r = c.post("/api/auth/forgot", json={"email": "user@example.com"})
        unknown = c.post("/api/auth/forgot", json={"email": "nobody@example.com"})
        assert r.status_code == unknown.status_code == 202
        assert r.json() == unknown.json()


def make_admin(database, email="user@example.com"):
    with database.engine.begin() as conn:
        conn.exec_driver_sql("update users set is_admin = true where email = ?"
                             if database.url.startswith("sqlite") else
                             "update users set is_admin = true where email = %s", (email,))


def test_admin_endpoints_need_admin(client, database):
    register(client)
    assert client.get("/api/auth/me").json() == {"email": "user@example.com", "isAdmin": False}
    r = client.get("/api/admin/stats")
    assert r.status_code == 403 and "manage.py make-admin" in r.json()["hint"]
    client.cookies.clear()
    assert client.get("/api/admin/stats").status_code == 401


def test_admin_stats_and_feedback(client, database):
    register(client)
    make_admin(database)
    sid = scan_id(client, "Your verification code is 482913 call 07700900123")
    prediction = client.get("/api/history").json()["items"][0]["prediction"]
    wrong_label = "legit" if prediction == "FRAUD" else "fraud"
    client.post(f"/api/scans/{sid}/feedback", json={"correctLabel": wrong_label, "note": "my bank"})
    scan_id(client, LEGIT[0])

    stats = client.get("/api/admin/stats").json()
    assert stats["users"] == 1 and stats["scans"] == 2 and stats["feedback"] == 1 and stats["reportedWrong"] == 1
    assert sum(d["count"] for d in stats["scansByDay"]) == 2

    item = client.get("/api/admin/feedback").json()["items"][0]
    assert item["wrong"] is True and item["note"] == "my bank"
    # Admins see scrubbed text, not the original digits.
    assert "482913" not in item["message"] and "07700900123" not in item["message"]


def test_cross_site_cookie_settings(model_path, database):
    with pytest.raises(ValueError, match="requires COOKIE_SECURE"):
        create_app(model_path=model_path, database=database, cookie_secure=False, cookie_samesite="none")
    app = create_app(model_path=model_path, database=database, extra_origins=[], cookie_secure=True,
                     cookie_samesite="none")
    with TestClient(app, base_url="https://testserver") as c:
        cookie = register(c).headers["set-cookie"].lower()
        assert "samesite=none" in cookie and "secure" in cookie


def test_model_downloads_from_model_url(model_path, database, tmp_path, monkeypatch):
    import hashlib
    target = tmp_path / "downloaded" / "model.joblib"
    monkeypatch.setenv("MODEL_URL", model_path.as_uri())
    monkeypatch.setenv("MODEL_SHA256", hashlib.sha256(model_path.read_bytes()).hexdigest())
    with TestClient(create_app(model_path=target, database=database, extra_origins=[])) as c:
        assert c.get("/api/health").json()["model"] == "test-lr"
    assert target.exists()


def test_model_download_checksum_mismatch(model_path, database, tmp_path, monkeypatch):
    monkeypatch.setenv("MODEL_URL", model_path.as_uri())
    monkeypatch.setenv("MODEL_SHA256", "0" * 64)
    with TestClient(create_app(model_path=tmp_path / "m.joblib", database=database, extra_origins=[])) as c:
        r = c.get("/api/health")
        assert r.status_code == 503 and "checksum" in r.json()["error"]


def test_scan_includes_link_risk_signals(client):
    register(client)
    result = client.post("/api/scan", json={"message": "HDFC: KYC pending, verify at hdfc-kyc.in"}).json()
    link = [s for s in result["detectedSignals"] if s["category"] == "link_risk"]
    assert link and link[0]["name"] == "Link Imitates a Known Brand" and link[0]["evidence"] == "hdfc-kyc.in"


def test_sqlite_feedback_cascade_prevents_cross_user_leak(client):
    register(client, email="a@example.com")
    sid = scan_id(client, "private first-user message")
    client.post(f"/api/scans/{sid}/feedback", json={"correctLabel": "legit", "note": "private note"})
    assert client.delete(f"/api/history/{sid}").status_code == 200

    client.post("/api/auth/logout")
    register(client, email="b@example.com")
    second = client.post("/api/scan", json={"message": "unrelated second-user message"}).json()
    # PK may be reused (SQLite) or advanced by SEQUENCE (Postgres); either way no leak.
    item = client.get("/api/history").json()["items"][0]
    assert item["id"] == second["id"]
    assert item["feedback"] is None and item["result"]["feedback"] is None


def test_sqlite_memory_database_is_shared_with_requests(model_path):
    app = create_app(model_path=model_path, database=Database("sqlite:///:memory:"),
                     extra_origins=[], cookie_secure=False)
    with TestClient(app) as c:
        assert register(c).status_code == 201
        assert c.get("/api/auth/me").status_code == 200


def test_malformed_model_reports_unavailable(tmp_path, database):
    path = tmp_path / "malformed.joblib"
    joblib.dump({"threshold": 0.5}, path)
    with TestClient(create_app(model_path=path, database=database, extra_origins=[])) as c:
        r = c.get("/api/health")
        assert r.status_code == 503 and "pipeline" in r.json()["error"]


def test_model_url_requires_checksum(tmp_path, database, monkeypatch):
    monkeypatch.setenv("MODEL_URL", "https://models.example/fraud.joblib")
    monkeypatch.delenv("MODEL_SHA256", raising=False)
    with TestClient(create_app(model_path=tmp_path / "model.joblib", database=database,
                               extra_origins=[])) as c:
        r = c.get("/api/health")
        assert r.status_code == 503 and "MODEL_SHA256" in r.json()["error"]


def test_new_reset_token_revokes_old_tokens(reset_client, outbox):
    register(reset_client)
    reset_client.post("/api/auth/forgot", json={"email": "user@example.com"})
    old = outbox.token()
    reset_client.post("/api/auth/forgot", json={"email": "user@example.com"})
    new = outbox.token()
    assert reset_client.post("/api/auth/reset", json={"token": old, "password": "old token password"}).status_code == 400
    assert reset_client.post("/api/auth/reset", json={"token": new, "password": "new token password"}).status_code == 200


def test_auth_responses_include_admin_role(client, database):
    register(client)
    make_admin(database)
    client.post("/api/auth/logout")
    r = client.post("/api/auth/login", json={"email": "user@example.com", "password": PASSWORD})
    assert r.status_code == 200 and r.json()["isAdmin"] is True


def test_timestamps_include_timezone(client):
    register(client)
    result = client.post("/api/scan", json={"message": LEGIT[0]}).json()
    assert re.search(r"(Z|[+-]\d\d:\d\d)$", result["timestamp"])


def test_combined_model_report_redacts_private_samples_and_terms():
    report = {
        "dataset": "combined.csv",
        "errorAnalysis": {"falseNegatives": [{"message": "Alice private SMS"}], "falsePositives": []},
        "topIndicators": [{"term": "alice"}],
    }
    safe = public_model_report(report)
    assert safe["errorAnalysis"]["falseNegatives"][0]["message"].startswith("[redacted")
    assert safe["topIndicators"] == []
    assert report["errorAnalysis"]["falseNegatives"][0]["message"] == "Alice private SMS"


def test_scan_rate_limit_is_configurable(model_path, database, monkeypatch):
    monkeypatch.setenv("SCAN_RATE_LIMIT", "2")
    app = create_app(model_path=model_path, database=database, extra_origins=[], cookie_secure=False)
    with TestClient(app) as c:
        register(c)
        for _ in range(2):
            assert c.post("/api/scan", json={"message": FRAUD[0]}).status_code == 200
        r = c.post("/api/scan", json={"message": FRAUD[0]})
        assert r.status_code == 429
        assert "2 scans per hour" in r.json()["hint"]
        assert "retry-after" in r.headers


@pytest.mark.parametrize("value", ["0", "-5", "lots", ""])
def test_invalid_scan_rate_limit_is_rejected(model_path, database, monkeypatch, value):
    monkeypatch.setenv("SCAN_RATE_LIMIT", value)
    with pytest.raises(ValueError, match="SCAN_RATE_LIMIT"):
        create_app(model_path=model_path, database=database, extra_origins=[], cookie_secure=False)


def test_production_without_smtp_warns_at_startup(model_path, database, monkeypatch, capsys):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("SMTP_HOST", raising=False)
    create_app(model_path=model_path, database=database, extra_origins=[], cookie_secure=False)
    assert "SMTP_HOST is not set" in capsys.readouterr().out
