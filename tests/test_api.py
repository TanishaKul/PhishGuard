import json
import os

import joblib
import pytest
from fastapi.testclient import TestClient
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

import spamham_project_v3 as sp
from api_server import MAX_BODY_BYTES, MAX_MESSAGE_CHARS, create_app
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
    assert client.get("/api/auth/me").json() == {"email": "user@example.com"}

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
