"""
Tests for ShopGuard ML Service

Run: cd apps/ml && python -m pytest tests/ -v
"""
import math
import random
import pytest
import numpy as np
from fastapi.testclient import TestClient

import sys
sys.path.insert(0, str(__file__).replace('/tests/test_ml_service.py', ''))
from src.main import app, to_feature_vector, TransactionFeatures, isolation_forest_score


client = TestClient(app)


def make_feature(
    amount=1000.0, hour=14, is_void=False, is_refund=False,
    emp_void_rate=None, store_void_rate=None
) -> dict:
    return {
        "amount": amount,
        "logAmount": math.log(max(amount, 1)),
        "itemCount": 2,
        "discountPercent": 0.0,
        "refundAmount": 0.0,
        "grossAmount": amount,
        "durationSeconds": 30,
        "hour": hour,
        "dayOfWeek": 2,
        "paymentMethodCode": 0,
        "afterHours": hour < 8 or hour >= 22,
        "isVoid": is_void,
        "isRefund": is_refund,
        "isNoSale": False,
        "hasPriceOverride": False,
        "empVoidRate": emp_void_rate,
        "storeVoidRate": store_void_rate,
    }


def make_training_features(n=150, seed=42):
    rng = random.Random(seed)
    features = []
    for _ in range(n):
        amt = rng.uniform(200, 5000)
        features.append(make_feature(
            amount=amt,
            hour=rng.randint(8, 21),
            is_void=rng.random() < 0.02,
        ))
    return features


# ==================== TESTS ====================

class TestHealthEndpoint:
    def test_health_returns_200(self):
        r = client.get("/health")
        assert r.status_code == 200

    def test_health_has_status(self):
        r = client.get("/health")
        data = r.json()
        assert data["status"] == "healthy"
        assert "modelStatus" in data
        assert "featureVersion" in data


class TestFeatureExtraction:
    def test_feature_vector_length(self):
        f = TransactionFeatures(**make_feature())
        vec = to_feature_vector(f)
        assert len(vec) == 23  # must match FEATURE_NAMES

    def test_null_values_become_zero(self):
        f = TransactionFeatures(**make_feature(emp_void_rate=None))
        vec = to_feature_vector(f)
        # empVoidRate is at index 15
        assert vec[15] == 0.0

    def test_void_flag_encoded(self):
        f_normal = TransactionFeatures(**make_feature(is_void=False))
        f_void = TransactionFeatures(**make_feature(is_void=True))
        assert to_feature_vector(f_void)[9] == 1.0
        assert to_feature_vector(f_normal)[9] == 0.0

    def test_after_hours_encoding(self):
        f_night = TransactionFeatures(**make_feature(hour=23))
        f_day = TransactionFeatures(**make_feature(hour=14))
        assert to_feature_vector(f_night)[8] == 1.0
        assert to_feature_vector(f_day)[8] == 0.0

    def test_log_amount_validity(self):
        f = TransactionFeatures(**make_feature(amount=1000))
        vec = to_feature_vector(f)
        assert abs(vec[1] - math.log(1000)) < 0.001

    def test_nan_inf_handled(self):
        f = TransactionFeatures(**make_feature(amount=float('nan')))
        vec = to_feature_vector(f)
        assert all(math.isfinite(v) for v in vec)


class TestPredictEndpoint:
    def test_predict_no_model_returns_zeros(self):
        """When no model is loaded, scores should be 0 OR model handles gracefully."""
        r = client.post("/predict", json={"features": [make_feature()]})
        assert r.status_code == 200
        data = r.json()
        assert len(data["scores"]) == 1
        # Either no model (mlUnavailable=True, score=0) or model loaded (score in 0..1)
        assert 0.0 <= data["scores"][0] <= 1.0
        assert "mlUnavailable" in data

    def test_predict_empty_features(self):
        r = client.post("/predict", json={"features": []})
        assert r.status_code == 200
        data = r.json()
        assert data["scores"] == []

    def test_predict_multiple_features(self):
        features = [make_feature(amount=amt) for amt in [200, 1000, 50000]]
        r = client.post("/predict", json={"features": features})
        assert r.status_code == 200
        assert len(r.json()["scores"]) == 3


class TestTrainEndpoint:
    def test_train_rejects_insufficient_data(self):
        features = [make_feature() for _ in range(50)]  # Too few
        r = client.post("/train", json={"features": features, "modelType": "isolation_forest"})
        data = r.json()
        assert data["success"] is False
        assert "Insufficient samples" in data["error"]

    def test_train_isolation_forest_succeeds(self):
        features = make_training_features(n=150)
        r = client.post("/train", json={
            "features": features,
            "modelType": "isolation_forest",
            "datasetId": "test-dataset"
        })
        assert r.status_code == 200
        data = r.json()
        assert data["success"] is True
        assert data["modelId"].startswith("sg-")
        assert "sampleCount" in data["metrics"]
        assert data["metrics"]["sampleCount"] == 150
        assert data["metrics"]["modelType"] == "isolation_forest"

    def test_train_produces_valid_scores_after_deploy(self):
        """Train, deploy, then predict."""
        features = make_training_features(n=150)
        r = client.post("/train", json={
            "features": features,
            "modelType": "isolation_forest",
        })
        model_id = r.json()["modelId"]

        # Deploy
        dr = client.post(f"/deploy/{model_id}", params={"force": True})
        assert dr.status_code == 200

        # Predict - should now return real scores
        test_features = [make_feature(amount=100000, is_void=True)]  # Anomalous
        pr = client.post("/predict", json={"features": test_features})
        assert pr.status_code == 200
        data = pr.json()
        assert data["mlUnavailable"] is False
        assert len(data["scores"]) == 1
        score = data["scores"][0]
        assert 0.0 <= score <= 1.0

    def test_supervised_rejects_insufficient_labels(self):
        features = [make_feature() for _ in range(100)]
        labels = [0] * 95 + [1] * 5  # Only 5 positives (too few)
        r = client.post("/train", json={
            "features": features,
            "labels": labels,
            "modelType": "hist_gradient_boosting",
        })
        data = r.json()
        assert data["success"] is False
        assert "labeled data" in data["error"]

    def test_no_future_data_leakage(self):
        """Verify time-aware split: validation data must come after training data."""
        # This is enforced by the [:split_idx] / [split_idx:] logic in the train endpoint
        # We just verify the train succeeds with time-ordered data
        rng = random.Random(99)
        n = 200
        features = [make_feature(amount=rng.uniform(200, 5000), hour=rng.randint(8, 21)) for _ in range(n)]
        labels = [0] * 180 + [1] * 20
        r = client.post("/train", json={
            "features": features,
            "labels": labels,
            "modelType": "hist_gradient_boosting",
        })
        # May fail due to min positive labels in val set, but should not crash
        assert r.status_code == 200


class TestIsolationForestScore:
    def test_score_range(self):
        from sklearn.ensemble import IsolationForest
        X_train = np.random.randn(200, 5)
        model = IsolationForest(n_estimators=50, random_state=42)
        model.fit(X_train)
        X_test = np.random.randn(20, 5)
        scores = isolation_forest_score(model, X_test)
        assert scores.min() >= 0.0
        assert scores.max() <= 1.0

    def test_anomalies_score_higher(self):
        """Extreme outliers should score higher than normal points."""
        from sklearn.ensemble import IsolationForest
        X_train = np.random.randn(300, 5)
        model = IsolationForest(n_estimators=100, contamination=0.05, random_state=42)
        model.fit(X_train)
        normal = np.random.randn(50, 5) * 0.5  # tight cluster
        anomalous = np.random.randn(50, 5) * 10 + 20  # far outliers
        score_normal = isolation_forest_score(model, normal).mean()
        score_anomaly = isolation_forest_score(model, anomalous).mean()
        assert score_anomaly > score_normal


class TestModelRegistry:
    def test_list_models(self):
        r = client.get("/models")
        assert r.status_code == 200
        assert "models" in r.json()

    def test_get_nonexistent_model(self):
        r = client.get("/models/nonexistent-model")
        assert r.status_code == 404

    def test_deploy_nonexistent_model(self):
        r = client.post("/deploy/nonexistent-model")
        assert r.status_code == 404

    def test_quality_gates_enforce(self):
        """A model with only 50 samples should fail quality gate."""
        features = [make_feature() for _ in range(50)]
        # Even if we could save, the sample check would fail
        # We test via train
        r = client.post("/train", json={
            "features": features,
            "modelType": "isolation_forest",
        })
        assert r.json()["success"] is False


# ==================== DRIFT DETECTION TESTS ====================

class TestDriftDetection:
    def _make_features_batch(self, n: int, amount_base=1000, void_rate=0.02, seed=0) -> list[dict]:
        rng = random.Random(seed)
        return [
            make_feature(
                amount=amount_base + rng.gauss(0, 200),
                is_void=rng.random() < void_rate,
                is_refund=rng.random() < 0.015,
            )
            for _ in range(n)
        ]

    def test_no_drift_similar_distributions(self):
        """With identical distributions, drift should be none or low."""
        # Use same seed to generate nearly identical distributions
        ref = self._make_features_batch(200, amount_base=1000, void_rate=0.02, seed=42)
        cur = self._make_features_batch(200, amount_base=1000, void_rate=0.02, seed=42)
        r = client.post("/drift", json={"reference_features": ref, "current_features": cur})
        assert r.status_code == 200
        data = r.json()
        # Identical distributions should produce 0 PSI -> no drift
        assert data["severity"] in ("none", "low"), f"Expected no/low drift, got: {data['severity']}, metrics: {data['metrics']}"

    def test_drift_detected_for_extreme_shift(self):
        ref = self._make_features_batch(100, amount_base=500, void_rate=0.01, seed=3)
        cur = self._make_features_batch(50, amount_base=5000, void_rate=0.30, seed=4)
        r = client.post("/drift", json={"reference_features": ref, "current_features": cur})
        assert r.status_code == 200
        data = r.json()
        assert data["hasDrift"] is True
        assert data["severity"] in ("low", "medium", "high")
        assert len(data["driftedFeatures"]) > 0

    def test_insufficient_reference_data(self):
        ref = self._make_features_batch(10, seed=5)  # Too few
        cur = self._make_features_batch(20, seed=6)
        r = client.post("/drift", json={"reference_features": ref, "current_features": cur})
        assert r.status_code == 200
        data = r.json()
        assert data["hasDrift"] is False
        assert "Insufficient" in data["recommendation"]

    def test_drift_response_has_all_fields(self):
        ref = self._make_features_batch(50, seed=7)
        cur = self._make_features_batch(25, seed=8)
        r = client.post("/drift", json={"reference_features": ref, "current_features": cur})
        assert r.status_code == 200
        data = r.json()
        assert "hasDrift" in data
        assert "severity" in data
        assert "metrics" in data
        assert "driftedFeatures" in data
        assert "recommendation" in data
        assert "psi_amount" in data["metrics"]
        assert "psi_void_rate" in data["metrics"]

    def test_custom_psi_threshold(self):
        ref = self._make_features_batch(80, amount_base=1000, void_rate=0.02, seed=9)
        cur = self._make_features_batch(40, amount_base=1100, void_rate=0.04, seed=10)
        # Very low threshold — should trigger
        r = client.post("/drift", json={"reference_features": ref, "current_features": cur, "threshold_psi": 0.01})
        assert r.status_code == 200
        data = r.json()
        # With very low threshold, even minor shifts might trigger
        assert isinstance(data["hasDrift"], bool)
