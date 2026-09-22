# -*- coding: utf-8 -*-
"""
PHISHGUARD Python ML API Bridge Server
Provides a REST API for the Next.js frontend over the trained scikit-learn pipeline.

Endpoints:
  GET  /api/health   model status (503 if no model is loaded)
  GET  /api/metrics  evaluation report saved at training time
  POST /api/scan     {"message": str, "threshold"?: float in (0, 1)}

Run: python api_server.py --port 8000
"""

import argparse
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import joblib

import message_analysis
import spamham_project_v3 as sp

MODEL_PATH = Path("fraud_model.joblib")
TRAIN_COMMAND = "python spamham_project_v3.py --data spam.csv"

# Concatenated SMS tops out around 1,600 characters; this leaves headroom
# without letting one request tie up the model.
MAX_MESSAGE_CHARS = 5000
MAX_BODY_BYTES = 64 * 1024

DEFAULT_ALLOWED_ORIGINS = re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$")

pipeline = None
default_threshold = None
model_name = None
report = None
feature_index = None
load_error = None


class ApiError(Exception):
    def __init__(self, status, message, hint=None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.hint = hint


def load_ml_model(path):
    global pipeline, default_threshold, model_name, report, feature_index, load_error
    if not path.exists():
        load_error = f"Model file {path} not found. Train it first: {TRAIN_COMMAND}"
        print(f"[PhishGuard] {load_error}")
        return
    try:
        data = joblib.load(path)
    except Exception as exc:
        # Typically a model pickled by an older script version.
        load_error = f"Could not load {path} ({exc}). Retrain it: {TRAIN_COMMAND}"
        print(f"[PhishGuard] {load_error}")
        return

    pipeline = data["pipeline"]
    default_threshold = float(data["threshold"])
    model_name = data["model_name"]
    report = data.get("report")
    feature_index = sp.feature_index(pipeline)
    print(f"[PhishGuard] Loaded {model_name} with threshold {default_threshold:.4f}")
    if report is None:
        print(f"[PhishGuard] Model has no evaluation report; /api/metrics will be "
              f"unavailable until you retrain: {TRAIN_COMMAND}")


def require_model():
    if pipeline is None:
        raise ApiError(503, "The fraud model is not loaded.", load_error)


def parse_scan_request(payload):
    if not isinstance(payload, dict):
        raise ApiError(400, "Request body must be a JSON object.",
                       'Send {"message": "<sms text>"}.')

    message = payload.get("message")
    if not isinstance(message, str):
        raise ApiError(400, "Field 'message' is required and must be a string.")
    message = message.strip()
    if not message:
        raise ApiError(400, "Field 'message' is empty.", "Paste the SMS text to scan.")
    if len(message) > MAX_MESSAGE_CHARS:
        raise ApiError(413, f"Message is {len(message)} characters; the limit is "
                            f"{MAX_MESSAGE_CHARS}.", "Scan one SMS at a time.")

    threshold = payload.get("threshold", default_threshold)
    if threshold is None:
        threshold = default_threshold
    if isinstance(threshold, bool) or not isinstance(threshold, (int, float)):
        raise ApiError(400, "Field 'threshold' must be a number.")
    if not 0 < threshold < 1:
        raise ApiError(400, f"Field 'threshold' must be between 0 and 1 (exclusive); "
                            f"got {threshold}.")
    return message, float(threshold)


class PhishGuardAPIHandler(BaseHTTPRequestHandler):
    allowed_origins = DEFAULT_ALLOWED_ORIGINS

    def _cors_headers(self):
        origin = self.headers.get("Origin")
        if origin and self.allowed_origins.match(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, err):
        body = {"error": err.message}
        if err.hint:
            body["hint"] = err.hint
        self._send_json(body, status=err.status)

    def _read_json_body(self):
        content_type = self.headers.get("Content-Type", "").split(";")[0].strip().lower()
        if content_type != "application/json":
            raise ApiError(415, f"Unsupported Content-Type '{content_type or 'none'}'.",
                           "Send the body as application/json.")

        length_header = self.headers.get("Content-Length")
        if length_header is None:
            raise ApiError(411, "Content-Length header is required.")
        try:
            length = int(length_header)
        except ValueError:
            raise ApiError(400, "Content-Length header is not a number.")
        if length > MAX_BODY_BYTES:
            # Close the connection instead of reading the oversized body.
            self.close_connection = True
            raise ApiError(413, f"Request body is {length} bytes; the limit is "
                                f"{MAX_BODY_BYTES} bytes.", "Scan one SMS at a time.")

        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except UnicodeDecodeError:
            raise ApiError(400, "Request body is not valid UTF-8.")
        except json.JSONDecodeError as exc:
            raise ApiError(400, f"Request body is not valid JSON: {exc.msg} "
                                f"(line {exc.lineno}, column {exc.colno}).")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        try:
            if path == "/api/health":
                if pipeline is None:
                    self._send_json({"status": "model_unavailable", "error": load_error},
                                    status=503)
                else:
                    self._send_json({"status": "active", "model": model_name,
                                     "threshold": default_threshold,
                                     "hasReport": report is not None})
            elif path == "/api/metrics":
                require_model()
                if report is None:
                    raise ApiError(503, "The loaded model has no saved evaluation report.",
                                   f"Retrain it: {TRAIN_COMMAND}")
                self._send_json(report)
            else:
                raise ApiError(404, f"No endpoint at GET {path}.")
        except ApiError as err:
            self._send_error(err)

    def do_POST(self):
        path = self.path.split("?")[0]
        try:
            if path != "/api/scan":
                raise ApiError(404, f"No endpoint at POST {path}.")
            require_model()
            message, threshold = parse_scan_request(self._read_json_body())
            try:
                result = message_analysis.analyze(pipeline, message, threshold, feature_index)
            except Exception as exc:
                print(f"[PhishGuard] Inference failed: {exc!r}")
                raise ApiError(500, "The model failed to score this message.",
                               "Check the API server log; retraining may be required.")
            self._send_json(result)
        except ApiError as err:
            self._send_error(err)


def main():
    parser = argparse.ArgumentParser(description="PhishGuard Python API Bridge")
    parser.add_argument("--port", type=int, default=8000, help="Port to serve on (default: 8000)")
    parser.add_argument("--host", default="127.0.0.1",
                        help="Interface to bind (default: 127.0.0.1; use 0.0.0.0 to expose)")
    parser.add_argument("--model", type=Path, default=MODEL_PATH)
    parser.add_argument("--allow-origin", action="append", default=[],
                        help="Extra CORS origin to allow (repeatable); localhost is always allowed")
    args = parser.parse_args()

    if args.allow_origin:
        extra = "|".join(re.escape(o.rstrip("/")) for o in args.allow_origin)
        PhishGuardAPIHandler.allowed_origins = re.compile(
            rf"{DEFAULT_ALLOWED_ORIGINS.pattern}|^(?:{extra})$")

    load_ml_model(args.model)
    server = ThreadingHTTPServer((args.host, args.port), PhishGuardAPIHandler)
    print(f"[PhishGuard] Python API Bridge running at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[PhishGuard] Server stopped.")


if __name__ == "__main__":
    main()
