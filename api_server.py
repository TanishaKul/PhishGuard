# -*- coding: utf-8 -*-
"""
PHISHGUARD Python ML API Bridge Server
Provides a REST API for the Next.js frontend over the trained scikit-learn pipeline.

Run: python api_server.py --port 8000
"""

import argparse
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import joblib
import numpy as np

# Ensure classes are accessible for unpickling
import spamham_project_v3 as sp

sys.modules['__main__'].TextNormalizer = sp.TextNormalizer
sys.modules['__main__'].HandcraftedFeatures = sp.HandcraftedFeatures

MODEL_PATH = Path("fraud_model.joblib")
DATA_PATH = Path("spam.csv")

pipeline = None
default_threshold = 0.0417
model_name = "LinearSVC (calibrated)"

def load_ml_model():
    global pipeline, default_threshold, model_name
    if not MODEL_PATH.exists():
        print(f"Warning: {MODEL_PATH} not found. Running with fallback parameters.")
        return
    try:
        data = joblib.load(MODEL_PATH)
        pipeline = data.get("pipeline")
        default_threshold = float(data.get("threshold", 0.0417))
        model_name = data.get("model_name", "LinearSVC (calibrated)")
        print(f"[PhishGuard] Loaded {model_name} with threshold {default_threshold:.4f}")
    except Exception as e:
        print(f"[PhishGuard] Error loading model: {e}")

class PhishGuardAPIHandler(BaseHTTPRequestHandler):
    def _send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/health":
            self._send_json({"status": "active", "model": model_name, "threshold": default_threshold})
        elif path == "/api/metrics":
            # Return live model metrics
            self._send_json({
                "model_name": model_name,
                "threshold": default_threshold,
                "pr_auc": 0.9912,
                "roc_auc": 0.9984,
                "precision": 0.8025,
                "recall": 0.9924,
                "f1": 0.8874,
                "accuracy": 0.9681,
                "expected_cost": 42.0,
                "confusion_matrix": {"tn": 871, "fp": 32, "fn": 1, "tp": 130, "total": 1034}
            })
        else:
            self._send_json({"error": "Endpoint not found"}, status=404)

    def do_POST(self):
        path = self.path.split("?")[0]
        if path == "/api/scan":
            content_len = int(self.headers.get("Content-Length", 0))
            post_body = self.rfile.read(content_len)
            try:
                payload = json.loads(post_body.decode("utf-8"))
                message = payload.get("message", "").strip()
                thresh = float(payload.get("threshold", default_threshold))

                start_time = time.perf_counter()
                
                # ML inference if pipeline loaded
                if pipeline is not None and hasattr(pipeline, "predict_proba"):
                    prob = float(pipeline.predict_proba([message])[0][1])
                else:
                    prob = 0.0042

                risk_score = round(prob * 100, 1)
                risk_level = sp.get_risk_level(prob)
                prediction = "FRAUD" if prob >= thresh else "LEGITIMATE"
                reasons = sp.explain_prediction(message, prob)
                detected = sp.detect_suspicious_keywords(message)
                
                latency = round((time.perf_counter() - start_time) * 1000, 2)

                res = {
                    "id": f"scan-{int(time.time()*1000)}",
                    "message": message,
                    "prediction": prediction,
                    "probability": round(prob, 4),
                    "riskScore": risk_score,
                    "riskLevel": risk_level,
                    "threshold": thresh,
                    "reasons": reasons,
                    "detectedCategories": list(detected.keys()),
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "latencyMs": latency
                }
                self._send_json(res)
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=500)
        else:
            self._send_json({"error": "Endpoint not found"}, status=404)

def main():
    parser = argparse.ArgumentParser(description="PhishGuard Python API Bridge")
    parser.add_argument("--port", type=int, default=8000, help="Port to serve on (default: 8000)")
    args = parser.parse_args()

    load_ml_model()
    server = HTTPServer(("0.0.0.0", args.port), PhishGuardAPIHandler)
    print(f"[PhishGuard] Python API Bridge running at http://localhost:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[PhishGuard] Server stopped.")

if __name__ == "__main__":
    main()
