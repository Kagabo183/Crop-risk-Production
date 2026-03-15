"""Tests for the auto-fetch-satellite endpoint and classification pipeline fixes."""
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from app.main import app
from app.core.auth import get_current_active_user, require_farmer_or_above
from app.db.database import get_db

client = TestClient(app)


# ── Helpers ──────────────────────────────────────────────

def _fake_user():
    user = MagicMock()
    user.id = 1
    user.role = "admin"
    user.is_active = True
    return user


def _fake_db():
    return MagicMock()


def _override_deps():
    """Override auth + DB for all tests."""
    app.dependency_overrides[get_current_active_user] = _fake_user
    app.dependency_overrides[require_farmer_or_above] = _fake_user
    app.dependency_overrides[get_db] = _fake_db


def _clear_overrides():
    app.dependency_overrides.clear()


# ── Tests ────────────────────────────────────────────────

class TestAutoFetchSatellite:
    """Tests for POST /api/v1/farms/{farm_id}/auto-fetch-satellite"""

    def setup_method(self):
        _override_deps()

    def teardown_method(self):
        _clear_overrides()

    @patch("app.api.v1.endpoints.farms.process_single_farm")
    @patch("app.api.v1.endpoints.farms.analyze_single_farm_risk")
    def test_auto_fetch_returns_202(self, mock_risk, mock_sat):
        """Endpoint should return 202 with task_id when farm exists and has coords."""
        farm = MagicMock()
        farm.id = 1
        farm.latitude = -1.95
        farm.longitude = 29.87
        farm.owner_id = 1

        mock_task = MagicMock()
        mock_task.id = "abc-123"
        mock_sat.delay.return_value = mock_task

        db = _fake_db()
        db.query.return_value.filter.return_value.first.return_value = farm
        app.dependency_overrides[get_db] = lambda: db

        resp = client.post("/api/v1/farms/1/auto-fetch-satellite")
        assert resp.status_code == 202
        body = resp.json()
        assert body["task_id"] == "abc-123"
        assert body["farm_id"] == 1
        mock_sat.delay.assert_called_once_with(1, 30)

    def test_auto_fetch_farm_not_found(self):
        """Should 404 when farm does not exist."""
        db = _fake_db()
        db.query.return_value.filter.return_value.first.return_value = None
        app.dependency_overrides[get_db] = lambda: db

        resp = client.post("/api/v1/farms/999/auto-fetch-satellite")
        assert resp.status_code == 404

    def test_auto_fetch_no_coords(self):
        """Should 400 when farm has no coordinates."""
        farm = MagicMock()
        farm.id = 2
        farm.latitude = None
        farm.longitude = None
        farm.owner_id = 1

        db = _fake_db()
        db.query.return_value.filter.return_value.first.return_value = farm
        app.dependency_overrides[get_db] = lambda: db

        resp = client.post("/api/v1/farms/2/auto-fetch-satellite")
        assert resp.status_code == 400


class TestDiseaseClassifyResponseSchema:
    """Verify the DiseaseClassifyResponse schema includes error/model_version."""

    def test_schema_has_error_field(self):
        from app.api.v1.endpoints.ml import DiseaseClassifyResponse
        fields = DiseaseClassifyResponse.model_fields
        assert "error" in fields
        assert "model_version" in fields


class TestDiseaseClassifierLoadModel:
    """Verify load_model returns False when model file is missing."""

    @patch("app.ml.disease_classifier.DiseaseClassifier._setup_device")
    @patch("app.ml.disease_classifier.DiseaseClassifier._setup_transforms")
    def test_load_model_missing_file_returns_false(self, mock_transforms, mock_device):
        from app.ml.disease_classifier import DiseaseClassifier
        classifier = DiseaseClassifier()
        # Point to a non-existent model path
        result = classifier.load_model("/tmp/nonexistent_model.pth")
        assert result is False
        assert not classifier.model_loaded
