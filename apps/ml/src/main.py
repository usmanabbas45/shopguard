"""
ShopGuard ML Service
====================
FastAPI service implementing the ML anomaly detection layer.

Stage 1: Isolation Forest (unsupervised anomaly detection)
Stage 2: HistGradientBoostingClassifier (supervised, once enough labeled data)

Rules:
- NEVER train on future data
- NEVER mix demo data with production training
- ALWAYS fall back gracefully if model unavailable
- NEVER expose raw fraud probability to users
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
import numpy as np
import os
import json
import logging
import time
from pathlib import Path

logger = logging.getLogger("shopguard.ml")
logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="ShopGuard ML Service",
    description="Anomaly detection for retail transaction intelligence",
    version="1.0.0",
)

# ==================== SCHEMAS ====================

class TransactionFeatures(BaseModel):
    amount: float
    logAmount: float
    itemCount: float
    discountPercent: float
    refundAmount: float
    grossAmount: float
    durationSeconds: float
    hour: int
    dayOfWeek: int
    paymentMethodCode: int  # 0=cash 1=card 2=mobile 3=other
    afterHours: bool
    isVoid: bool
    isRefund: bool
    isNoSale: bool
    hasPriceOverride: bool

    # Employee context (null = no baseline available)
    empTxPerHour: Optional[float] = None
    empAvgAmount: Optional[float] = None
    empVoidRate: Optional[float] = None
    empRefundRate: Optional[float] = None
    empDiscountRate: Optional[float] = None

    # Deviations (null if no baseline)
    amountDeviationFromEmpBaseline: Optional[float] = None
    amountDeviationFromStoreBaseline: Optional[float] = None
    voidRateDeviationFromEmpBaseline: Optional[float] = None

    # Store context
    storeAvgAmount: Optional[float] = None
    storeVoidRate: Optional[float] = None
    storeRefundRate: Optional[float] = None

    # Time context
    hourlyAvgVolume: Optional[float] = None
    hourlyAvgAmount: Optional[float] = None

    featureVersion: str = "1.0.0"


class PredictRequest(BaseModel):
    features: list[TransactionFeatures]


class PredictResponse(BaseModel):
    scores: list[float]
    modelVersion: str
    modelType: str
    mlUnavailable: bool = False


class TrainRequest(BaseModel):
    features: list[TransactionFeatures]
    labels: Optional[list[int]] = None  # 0=normal, 1=anomaly, None=unsupervised
    modelType: str = "isolation_forest"
    datasetId: str = ""
    organizationId: Optional[str] = None


class TrainResponse(BaseModel):
    success: bool
    modelId: str
    modelVersion: str
    metrics: dict
    error: Optional[str] = None


class ModelInfo(BaseModel):
    modelId: str
    modelType: str
    version: str
    status: str
    trainedAt: Optional[str]
    sampleCount: Optional[int]
    metrics: Optional[dict]


# ==================== FEATURE EXTRACTION ====================

FEATURE_NAMES = [
    "amount", "logAmount", "itemCount", "discountPercent", "refundAmount",
    "hour", "dayOfWeek", "paymentMethodCode",
    "afterHours", "isVoid", "isRefund", "isNoSale", "hasPriceOverride",
    "empTxPerHour", "empAvgAmount", "empVoidRate", "empRefundRate", "empDiscountRate",
    "amountDeviationFromEmpBaseline", "amountDeviationFromStoreBaseline",
    "voidRateDeviationFromEmpBaseline",
    "storeVoidRate", "storeRefundRate",
]

FEATURE_VERSION = "1.0.0"


def to_feature_vector(f: TransactionFeatures) -> list[float]:
    """Convert TransactionFeatures to a float vector, filling nulls with 0."""
    def safe(v) -> float:
        if v is None or (isinstance(v, float) and not np.isfinite(v)):
            return 0.0
        return float(v)

    return [
        safe(f.amount),
        safe(f.logAmount),
        safe(f.itemCount),
        safe(f.discountPercent),
        safe(f.refundAmount),
        safe(f.hour),
        safe(f.dayOfWeek),
        safe(f.paymentMethodCode),
        1.0 if f.afterHours else 0.0,
        1.0 if f.isVoid else 0.0,
        1.0 if f.isRefund else 0.0,
        1.0 if f.isNoSale else 0.0,
        1.0 if f.hasPriceOverride else 0.0,
        safe(f.empTxPerHour),
        safe(f.empAvgAmount),
        safe(f.empVoidRate),
        safe(f.empRefundRate),
        safe(f.empDiscountRate),
        safe(f.amountDeviationFromEmpBaseline),
        safe(f.amountDeviationFromStoreBaseline),
        safe(f.voidRateDeviationFromEmpBaseline),
        safe(f.storeVoidRate),
        safe(f.storeRefundRate),
    ]


# ==================== MODEL REGISTRY ====================

MODEL_DIR = Path(os.environ.get("ML_MODEL_DIR", "/tmp/shopguard_models"))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

_production_model = None
_production_model_info: dict = {}


def _model_path(model_id: str) -> Path:
    return MODEL_DIR / f"{model_id}.pkl"


def _info_path(model_id: str) -> Path:
    return MODEL_DIR / f"{model_id}.json"


def load_production_model():
    """Load the current production model from disk."""
    global _production_model, _production_model_info
    registry_path = MODEL_DIR / "production.json"
    if not registry_path.exists():
        return
    try:
        import joblib
        info = json.loads(registry_path.read_text())
        model_path = _model_path(info["modelId"])
        if model_path.exists():
            _production_model = joblib.load(model_path)
            _production_model_info = info
            logger.info(f"Loaded production model: {info['modelId']} ({info['modelType']})")
    except Exception as e:
        logger.error(f"Failed to load production model: {e}")


def save_model(model, model_id: str, info: dict):
    import joblib
    joblib.dump(model, _model_path(model_id))
    _info_path(model_id).write_text(json.dumps(info, indent=2))
    logger.info(f"Saved model {model_id}")


def set_production_model(model_id: str):
    global _production_model, _production_model_info
    info_path = _info_path(model_id)
    if not info_path.exists():
        raise ValueError(f"Model {model_id} not found")
    import joblib
    info = json.loads(info_path.read_text())
    _production_model = joblib.load(_model_path(model_id))
    _production_model_info = info
    registry_path = MODEL_DIR / "production.json"
    registry_path.write_text(json.dumps(info, indent=2))
    logger.info(f"Set production model: {model_id}")


# Load production model at startup
load_production_model()


# ==================== INFERENCE ====================

def isolation_forest_score(model, X: np.ndarray) -> np.ndarray:
    """
    Convert IsolationForest score_samples output to 0..1 anomaly score.
    score_samples returns negative scores where more negative = more anomalous.
    We normalize to 0..1 where 1 = most anomalous.
    """
    raw = model.score_samples(X)
    # Negate so more anomalous = higher value
    neg = -raw
    # Clip to reasonable range and normalize
    neg = np.clip(neg, 0, 1)
    return neg


# ==================== ENDPOINTS ====================

@app.get("/health")
def health():
    model_status = "loaded" if _production_model is not None else "no_model"
    return {
        "status": "healthy",
        "modelStatus": model_status,
        "modelId": _production_model_info.get("modelId"),
        "modelType": _production_model_info.get("modelType"),
        "featureVersion": FEATURE_VERSION,
    }


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    if not req.features:
        return PredictResponse(scores=[], modelVersion="none", modelType="none")

    if _production_model is None:
        # No model: return 0 scores so rules+baselines handle it
        return PredictResponse(
            scores=[0.0] * len(req.features),
            modelVersion="none",
            modelType="rules_only",
            mlUnavailable=True,
        )

    try:
        X = np.array([to_feature_vector(f) for f in req.features])
        model_type = _production_model_info.get("modelType", "isolation_forest")

        if model_type == "isolation_forest":
            scores = isolation_forest_score(_production_model, X).tolist()
        elif model_type in ("hist_gradient_boosting", "supervised"):
            # Returns probability of anomaly class
            proba = _production_model.predict_proba(X)
            scores = proba[:, 1].tolist()  # P(anomaly)
        else:
            scores = [0.0] * len(req.features)

        return PredictResponse(
            scores=scores,
            modelVersion=_production_model_info.get("version", "unknown"),
            modelType=model_type,
        )
    except Exception as e:
        logger.error(f"Prediction failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/train", response_model=TrainResponse)
def train(req: TrainRequest):
    """Train a new candidate model. Does NOT auto-deploy."""
    if not req.features:
        return TrainResponse(
            success=False, modelId="", modelVersion="", metrics={},
            error="No training data provided"
        )

    try:
        import sklearn
        from sklearn.ensemble import IsolationForest, HistGradientBoostingClassifier
        from sklearn.preprocessing import StandardScaler
        from sklearn.pipeline import Pipeline
        from sklearn.metrics import (
            roc_auc_score, precision_score, recall_score, f1_score,
            confusion_matrix
        )
        import uuid
        import datetime

        X = np.array([to_feature_vector(f) for f in req.features])
        n_samples = len(X)

        model_id = f"sg-{req.modelType}-{uuid.uuid4().hex[:8]}"
        version = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")
        metrics: dict = {
            "sampleCount": n_samples,
            "featureVersion": FEATURE_VERSION,
            "sklearnVersion": sklearn.__version__,
        }

        if req.modelType == "isolation_forest" or req.labels is None:
            # Unsupervised: Isolation Forest
            # Do NOT train if sample size is too small
            if n_samples < 100:
                return TrainResponse(
                    success=False, modelId="", modelVersion="", metrics={},
                    error=f"Insufficient samples ({n_samples}). Minimum 100 required for Isolation Forest."
                )

            model = Pipeline([
                ("scaler", StandardScaler()),
                ("iso", IsolationForest(
                    n_estimators=200,
                    contamination=0.05,  # expected ~5% anomaly rate
                    random_state=42,
                    n_jobs=-1,
                ))
            ])
            model.fit(X)

            # Compute anomaly scores on training data for reference
            scores = isolation_forest_score(model["iso"], model["scaler"].transform(X))
            metrics["meanScore"] = float(scores.mean())
            metrics["stdScore"] = float(scores.std())
            metrics["p95Score"] = float(np.percentile(scores, 95))
            metrics["modelType"] = "isolation_forest"

        elif req.modelType in ("hist_gradient_boosting", "supervised") and req.labels is not None:
            labels = np.array(req.labels)
            n_positive = int(labels.sum())
            n_negative = int((1 - labels).sum())

            # Minimum labeled data check
            if n_positive < 20 or n_negative < 50:
                return TrainResponse(
                    success=False, modelId="", modelVersion="", metrics={},
                    error=f"Insufficient labeled data. Need ≥20 positives ({n_positive}) and ≥50 negatives ({n_negative})."
                )

            # Time-aware split: use last 20% as validation
            split_idx = int(n_samples * 0.8)
            X_train, X_val = X[:split_idx], X[split_idx:]
            y_train, y_val = labels[:split_idx], labels[split_idx:]

            model = Pipeline([
                ("clf", HistGradientBoostingClassifier(
                    max_iter=200,
                    learning_rate=0.05,
                    max_depth=6,
                    min_samples_leaf=20,
                    random_state=42,
                    class_weight="balanced",
                ))
            ])
            model.fit(X_train, y_train)

            # Evaluate on validation set
            if len(y_val) > 0 and y_val.sum() > 0:
                y_proba = model.predict_proba(X_val)[:, 1]
                y_pred = (y_proba >= 0.5).astype(int)
                cm = confusion_matrix(y_val, y_pred)
                metrics.update({
                    "rocAuc": float(roc_auc_score(y_val, y_proba)),
                    "precision": float(precision_score(y_val, y_pred, zero_division=0)),
                    "recall": float(recall_score(y_val, y_pred, zero_division=0)),
                    "f1": float(f1_score(y_val, y_pred, zero_division=0)),
                    "confusionMatrix": cm.tolist(),
                    "falsePositiveRate": float(cm[0][1] / max(cm[0].sum(), 1)),
                    "valSamples": len(y_val),
                    "trainSamples": len(y_train),
                })
            metrics["modelType"] = "hist_gradient_boosting"
        else:
            return TrainResponse(
                success=False, modelId="", modelVersion="", metrics={},
                error=f"Unknown model type: {req.modelType}"
            )

        import datetime
        info = {
            "modelId": model_id,
            "modelType": req.modelType,
            "version": version,
            "featureVersion": FEATURE_VERSION,
            "status": "CANDIDATE",  # Never auto-promote to production
            "isProduction": False,
            "trainedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "sampleCount": n_samples,
            "datasetId": req.datasetId,
            "organizationId": req.organizationId,
            "metrics": metrics,
        }
        save_model(model, model_id, info)

        return TrainResponse(
            success=True,
            modelId=model_id,
            modelVersion=version,
            metrics=metrics,
        )

    except Exception as e:
        logger.error(f"Training failed: {e}", exc_info=True)
        return TrainResponse(
            success=False, modelId="", modelVersion="", metrics={},
            error=str(e)
        )


@app.post("/deploy/{model_id}")
def deploy_model(model_id: str, force: bool = False):
    """
    Deploy a candidate model to production.
    Performs quality gates before deploying.
    Never replaces a better production model with a worse candidate.
    """
    info_path = _info_path(model_id)
    if not info_path.exists():
        raise HTTPException(status_code=404, detail="Model not found")

    info = json.loads(info_path.read_text())
    metrics = info.get("metrics", {})

    # Quality gates
    gates = []

    # Gate 1: Minimum sample count
    sample_count = info.get("sampleCount", 0)
    min_samples = 100 if info.get("modelType") == "isolation_forest" else 200
    if sample_count < min_samples:
        gates.append(f"Insufficient samples: {sample_count} < {min_samples}")

    # Gate 2: For supervised model, check false positive rate
    if info.get("modelType") in ("hist_gradient_boosting", "supervised"):
        fpr = metrics.get("falsePositiveRate", 1.0)
        if fpr > 0.15:  # Max 15% false positive rate
            gates.append(f"False positive rate too high: {fpr:.1%} > 15%")

        auc = metrics.get("rocAuc", 0)
        if auc < 0.65:
            gates.append(f"ROC AUC too low: {auc:.3f} < 0.65")

    # Gate 3: Compare against current production
    if _production_model is not None and not force:
        prod_metrics = _production_model_info.get("metrics", {})
        prod_auc = prod_metrics.get("rocAuc", 0)
        cand_auc = metrics.get("rocAuc", 0)
        if prod_auc > 0 and cand_auc > 0 and cand_auc < prod_auc - 0.02:
            gates.append(f"Candidate AUC ({cand_auc:.3f}) worse than production ({prod_auc:.3f})")

    if gates and not force:
        raise HTTPException(
            status_code=400,
            detail={"message": "Quality gates failed", "failedGates": gates}
        )

    try:
        # Retire current production
        if _production_model_info.get("modelId"):
            old_info_path = _info_path(_production_model_info["modelId"])
            if old_info_path.exists():
                old_info = json.loads(old_info_path.read_text())
                old_info["status"] = "RETIRED"
                old_info_path.write_text(json.dumps(old_info, indent=2))

        import datetime
        info["status"] = "PRODUCTION"
        info["isProduction"] = True
        info["deployedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        info_path.write_text(json.dumps(info, indent=2))
        set_production_model(model_id)

        return {"success": True, "modelId": model_id, "gates": gates, "forced": force}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/models")
def list_models():
    """List all models in the registry."""
    models = []
    for info_file in MODEL_DIR.glob("*.json"):
        if info_file.name == "production.json":
            continue
        try:
            info = json.loads(info_file.read_text())
            models.append(ModelInfo(
                modelId=info.get("modelId", ""),
                modelType=info.get("modelType", ""),
                version=info.get("version", ""),
                status=info.get("status", "UNKNOWN"),
                trainedAt=info.get("trainedAt"),
                sampleCount=info.get("sampleCount"),
                metrics=info.get("metrics"),
            ))
        except Exception:
            continue
    return {"models": models, "productionModelId": _production_model_info.get("modelId")}


@app.get("/models/{model_id}")
def get_model(model_id: str):
    info_path = _info_path(model_id)
    if not info_path.exists():
        raise HTTPException(status_code=404, detail="Model not found")
    return json.loads(info_path.read_text())


@app.delete("/models/{model_id}")
def delete_model(model_id: str):
    if _production_model_info.get("modelId") == model_id:
        raise HTTPException(status_code=400, detail="Cannot delete production model")
    paths = [_model_path(model_id), _info_path(model_id)]
    for p in paths:
        if p.exists():
            p.unlink()
    return {"success": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

# ==================== DRIFT DETECTION ====================

class DriftRequest(BaseModel):
    reference_features: list[TransactionFeatures]  # historical baseline
    current_features: list[TransactionFeatures]    # recent window
    threshold_psi: float = 0.2  # PSI threshold for drift detection


class DriftResponse(BaseModel):
    hasDrift: bool
    severity: str  # none / low / medium / high
    metrics: dict[str, float]
    driftedFeatures: list[str]
    recommendation: str


def psi(expected: list[float], actual: list[float], bins: int = 10) -> float:
    """Population Stability Index — practical measure of distribution shift."""
    import numpy as np

    if len(expected) < 30 or len(actual) < 10:
        return 0.0  # Not enough data

    e = np.array(expected)
    a = np.array(actual)

    # Use quantiles from expected distribution
    quantiles = np.percentile(e, np.linspace(0, 100, bins + 1))
    quantiles[0] = -np.inf
    quantiles[-1] = np.inf

    e_counts, _ = np.histogram(e, bins=quantiles)
    a_counts, _ = np.histogram(a, bins=quantiles)

    # Avoid zeros
    e_pct = (e_counts + 0.5) / (e_counts.sum() + 0.5 * bins)
    a_pct = (a_counts + 0.5) / (a_counts.sum() + 0.5 * bins)

    psi_val = np.sum((a_pct - e_pct) * np.log(a_pct / e_pct))
    return float(psi_val)


@app.post("/drift", response_model=DriftResponse)
def detect_drift(req: DriftRequest):
    """
    Detect feature drift between reference and current distributions.
    PSI > 0.1 = minor shift (LOW), > 0.2 = significant (MEDIUM), > 0.25 = major (HIGH).
    """
    if len(req.reference_features) < 30:
        return DriftResponse(
            hasDrift=False,
            severity="none",
            metrics={},
            driftedFeatures=[],
            recommendation="Insufficient reference data for drift detection (need ≥30 samples)",
        )

    # Extract key features for drift monitoring
    ref_amounts = [f.amount for f in req.reference_features]
    cur_amounts = [f.amount for f in req.current_features]
    ref_void = [1.0 if f.isVoid else 0.0 for f in req.reference_features]
    cur_void = [1.0 if f.isVoid else 0.0 for f in req.current_features]
    ref_refund = [1.0 if f.isRefund else 0.0 for f in req.reference_features]
    cur_refund = [1.0 if f.isRefund else 0.0 for f in req.current_features]
    ref_discount = [f.discountPercent for f in req.reference_features]
    cur_discount = [f.discountPercent for f in req.current_features]

    metrics = {
        "psi_amount": psi(ref_amounts, cur_amounts),
        "psi_void_rate": psi(ref_void, cur_void),
        "psi_refund_rate": psi(ref_refund, cur_refund),
        "psi_discount": psi(ref_discount, cur_discount),
        "ref_mean_amount": float(sum(ref_amounts) / max(len(ref_amounts), 1)),
        "cur_mean_amount": float(sum(cur_amounts) / max(len(cur_amounts), 1)),
        "ref_void_rate": float(sum(ref_void) / max(len(ref_void), 1)),
        "cur_void_rate": float(sum(cur_void) / max(len(cur_void), 1)),
    }

    drifted = []
    max_psi = 0.0

    for feat, psi_val in [
        ("transaction_amount", metrics["psi_amount"]),
        ("void_rate", metrics["psi_void_rate"]),
        ("refund_rate", metrics["psi_refund_rate"]),
        ("discount_rate", metrics["psi_discount"]),
    ]:
        max_psi = max(max_psi, psi_val)
        if psi_val > req.threshold_psi:
            drifted.append(feat)

    if max_psi > 0.25:
        severity = "high"
        recommendation = "Significant feature drift detected. Review recent transactions and consider retraining."
    elif max_psi > 0.1:
        severity = "low"
        recommendation = "Minor feature shift detected. Monitor closely."
    else:
        severity = "none"
        recommendation = "No significant drift detected."

    has_drift = max_psi > req.threshold_psi

    logger.info(f"Drift check: max_psi={max_psi:.4f} severity={severity} drifted={drifted}")

    return DriftResponse(
        hasDrift=has_drift,
        severity=severity,
        metrics=metrics,
        driftedFeatures=drifted,
        recommendation=recommendation,
    )


# ==================== DNN — DEEP NEURAL NETWORK ====================
# NumPy MLP (tabular). PyTorch CPU wheel unavailable in this env.
# See src/dnn.py for architecture, training, quality gates, persistence.

try:
    from .dnn import (
        DNNConfig, ShopGuardMLP, DNNPreprocessor,
        train_dnn, dnn_predict_safe, save_dnn, load_dnn,
        get_production_dnn_id, set_production_dnn, rollback_dnn,
        DNN_MODEL_TYPE, FEATURE_VERSION as DNN_FEATURE_VERSION,
        MIN_POSITIVE_LABELS, MIN_TOTAL_LABELS,
    )
except ImportError:
    # fallback when running as script (python main.py) rather than as a package
    from dnn import (
        DNNConfig, ShopGuardMLP, DNNPreprocessor,
        train_dnn, dnn_predict_safe, save_dnn, load_dnn,
        get_production_dnn_id, set_production_dnn, rollback_dnn,
        DNN_MODEL_TYPE, FEATURE_VERSION as DNN_FEATURE_VERSION,
        MIN_POSITIVE_LABELS, MIN_TOTAL_LABELS,
    )

# In-process DNN model cache (loaded once at startup / on deploy)
_dnn_model: Optional[ShopGuardMLP]         = None
_dnn_preprocessor: Optional[DNNPreprocessor] = None
_dnn_model_id: Optional[str]               = None


def _load_production_dnn_if_needed() -> None:
    """Load production DNN into memory on first call or if model_id changed."""
    global _dnn_model, _dnn_preprocessor, _dnn_model_id
    current_id = get_production_dnn_id()
    if current_id == _dnn_model_id:
        return  # already loaded
    if current_id is None:
        _dnn_model = _dnn_preprocessor = _dnn_model_id = None
        return
    model, preprocessor, _ = load_dnn(current_id)
    _dnn_model        = model
    _dnn_preprocessor = preprocessor
    _dnn_model_id     = current_id
    if model:
        logger.info(f"Production DNN loaded: {current_id}")
    else:
        logger.warning(f"Production DNN {current_id} could not be loaded — DNN disabled")


# Load on startup
_load_production_dnn_if_needed()


# ── DNN request/response schemas ────────────────────────────────────────────

class DNNTrainRequest(BaseModel):
    features: list[TransactionFeatures]
    labels:   list[int]                     # 0=normal 1=anomaly (human-reviewed only)
    datasetId: str = ""
    organizationId: Optional[str] = None
    # optional hyperparameter overrides
    hidden_dims: Optional[list[int]] = None
    dropout:     Optional[float]     = None
    epochs:      Optional[int]       = None
    learning_rate: Optional[float]   = None


class DNNTrainResponse(BaseModel):
    success:    bool
    modelId:    str
    reason:     Optional[str]  = None
    nTotal:     int            = 0
    nPositive:  int            = 0
    nNegative:  int            = 0
    qualityGates: Optional[dict] = None
    history:    Optional[dict]   = None


class DNNStatusResponse(BaseModel):
    enabled:        bool
    framework:      str
    modelId:        Optional[str]
    featureVersion: str
    minSamplesNeeded:  int
    minPositiveNeeded: int
    productionModelId: Optional[str]
    status:         str
    message:        str


class DNNPredictRequest(BaseModel):
    features: list[TransactionFeatures]


class DNNPredictResponse(BaseModel):
    scores:   list[float]
    modelId:  Optional[str]
    fallback: bool   # True when DNN was skipped


# ── endpoints ────────────────────────────────────────────────────────────────

@app.get("/dnn/status", response_model=DNNStatusResponse)
def dnn_status():
    """Return DNN availability, production model, and data requirements."""
    _load_production_dnn_if_needed()
    prod_id = get_production_dnn_id()
    enabled = _dnn_model is not None and (_dnn_model._is_trained if _dnn_model else False)

    return DNNStatusResponse(
        enabled            = enabled,
        framework          = "numpy+scipy (PyTorch CPU wheel unavailable in build environment)",
        modelId            = _dnn_model_id,
        featureVersion     = DNN_FEATURE_VERSION,
        minSamplesNeeded   = MIN_TOTAL_LABELS,
        minPositiveNeeded  = MIN_POSITIVE_LABELS,
        productionModelId  = prod_id,
        status             = "active" if enabled else "no_production_model",
        message            = (
            "DNN active — production model loaded." if enabled
            else f"DNN training requires ≥{MIN_TOTAL_LABELS} reviewed samples "
                 f"(≥{MIN_POSITIVE_LABELS} positives). No production DNN deployed yet."
        ),
    )


@app.post("/dnn/predict", response_model=DNNPredictResponse)
def dnn_predict(req: DNNPredictRequest):
    """
    Batch DNN inference. Falls back silently to zeros if DNN unavailable.
    Output is an internal signal — never shown raw to end users.
    """
    _load_production_dnn_if_needed()

    if not req.features:
        return DNNPredictResponse(scores=[], modelId=_dnn_model_id, fallback=False)

    X_raw = np.array([to_feature_vector(f) for f in req.features])

    # dnn_predict_safe never raises — returns zeros on any failure
    scores  = dnn_predict_safe(_dnn_model, _dnn_preprocessor, X_raw).tolist()
    is_fallback = (_dnn_model is None or not _dnn_model._is_trained)

    return DNNPredictResponse(
        scores   = scores,
        modelId  = _dnn_model_id,
        fallback = is_fallback,
    )


@app.post("/dnn/train", response_model=DNNTrainResponse)
def dnn_train(req: DNNTrainRequest):
    """
    Train a DNN candidate from human-reviewed data.
    Does NOT auto-deploy. Returns candidate model ID for admin review.
    """
    import uuid as _uuid
    import datetime as _dt

    if len(req.features) != len(req.labels):
        raise HTTPException(status_code=400, detail="features and labels must have same length")

    # Build feature matrix using the existing canonical feature pipeline
    feature_vecs = [to_feature_vector(f) for f in req.features]

    # Apply any hyperparameter overrides
    cfg = DNNConfig()
    if req.hidden_dims:   cfg.hidden_dims    = req.hidden_dims
    if req.dropout:       cfg.dropout        = req.dropout
    if req.epochs:        cfg.epochs         = req.epochs
    if req.learning_rate: cfg.learning_rate  = req.learning_rate

    model, preprocessor, result = train_dnn(feature_vecs, req.labels, cfg)

    if not result["success"]:
        return DNNTrainResponse(
            success   = False,
            modelId   = "",
            reason    = result["reason"],
            nTotal    = result.get("n_total", len(req.features)),
            nPositive = result.get("n_positive", 0),
            nNegative = result.get("n_negative", 0),
        )

    model_id = f"dnn-{_uuid.uuid4().hex[:8]}"
    metadata = {
        "modelId":        model_id,
        "modelType":      DNN_MODEL_TYPE,
        "framework":      "numpy+scipy",
        "featureVersion": DNN_FEATURE_VERSION,
        "datasetId":      req.datasetId,
        "organizationId": req.organizationId,
        "trainedAt":      _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "nTotal":         result["n_total"],
        "nPositive":      result["n_positive"],
        "nNegative":      result["n_negative"],
        "qualityGates":   result["quality_gates"],
        "history":        result["history"],
        "cfg":            result["cfg"],
        "status":         "candidate",
    }

    if model and preprocessor:
        save_dnn(model, preprocessor, model_id, metadata)

    return DNNTrainResponse(
        success      = True,
        modelId      = model_id,
        nTotal       = result["n_total"],
        nPositive    = result["n_positive"],
        nNegative    = result["n_negative"],
        qualityGates = result["quality_gates"],
        history      = result["history"],
    )


@app.post("/dnn/deploy/{model_id}")
def dnn_deploy(model_id: str):
    """
    Promote a candidate DNN to production after admin review.
    Rejects if quality gates did not pass.
    """
    model, preprocessor, metadata = load_dnn(model_id)
    if model is None:
        raise HTTPException(status_code=404, detail=f"DNN model {model_id} not found")

    gates = metadata.get("qualityGates", {})
    if not gates.get("passed", False):
        failures = gates.get("failures", ["unknown"])
        raise HTTPException(
            status_code=409,
            detail=f"DNN candidate failed quality gates: {failures}. Not deployed.",
        )

    prev_id = get_production_dnn_id()
    set_production_dnn(model_id)
    _load_production_dnn_if_needed()

    return {
        "deployed":  model_id,
        "previous":  prev_id,
        "qualityGates": gates,
    }


@app.post("/dnn/rollback/{model_id}")
def dnn_rollback(model_id: str):
    """Roll DNN production back to a specific previous model."""
    ok = rollback_dnn(model_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"DNN model {model_id} not found for rollback")
    _load_production_dnn_if_needed()
    return {"rolledBackTo": model_id}


@app.get("/dnn/models")
def list_dnn_models():
    """List all saved DNN candidate/production models."""
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    prod_id = get_production_dnn_id()
    models  = []
    for p in sorted(MODEL_DIR.glob("dnn_*.json")):
        try:
            payload = json.loads(p.read_text())
            meta    = payload.get("metadata", {})
            models.append({
                "modelId":      meta.get("modelId", p.stem),
                "trainedAt":    meta.get("trainedAt"),
                "nTotal":       meta.get("nTotal"),
                "nPositive":    meta.get("nPositive"),
                "qualityGates": meta.get("qualityGates"),
                "status":       "production" if meta.get("modelId") == prod_id else "candidate",
            })
        except Exception:
            pass
    return {"models": models, "productionModelId": prod_id}
