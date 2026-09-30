import math

import pytest

from app.engines import matching, scoring
from app.engines.distance import haversine_km, road_km
from app.engines.scoring import Params


def cand(**kw):
    base = dict(distance_km=10.0, virgin_price=2000.0, virgin_co2=0.8, processing_cost=200.0, disposal=100.0,
                technical_fit=1.0, timing=1.0, hazardous=False, supply=100.0, demand=60.0)
    base.update(kw)
    return base


def test_basic_economics():
    m = scoring.score_one(cand(), Params(), co2_max=0.8)
    # 2000 - 10*4.5 - 200 + 100
    assert m["saving_per_tonne"] == pytest.approx(1855)
    assert m["tradable_tonnes"] == 60
    assert m["net_saving_per_year"] == pytest.approx(1855 * 60 * 12)
    assert m["co2_saved_per_year"] == pytest.approx((0.8 - 0.001) * 60 * 12, rel=1e-3)


def test_beyond_max_distance_is_skipped():
    assert scoring.score_one(cand(distance_km=301), Params(max_distance=300), 0.8) is None


def test_negative_saving_is_not_viable():
    assert scoring.score_one(cand(virgin_price=100, disposal=0), Params(), 0.8) is None


def test_carbon_price_can_rescue_marginal_match():
    c = cand(virgin_price=300, disposal=0, processing_cost=300)
    assert scoring.score_one(c, Params(), 0.8) is None
    m = scoring.score_one(c, Params(carbon_price=2000), 0.8)
    assert m is not None and m["net_saving_per_year"] > 0


def test_economic_score_clamped():
    m = scoring.score_one(cand(disposal=5000), Params(), 0.8)
    assert m["economic_score"] == 1.0


def test_hazard_penalty():
    a = scoring.score_one(cand(), Params(), 0.8)
    b = scoring.score_one(cand(hazardous=True), Params(), 0.8)
    assert b["score"] == pytest.approx(a["score"] * 0.9, rel=1e-3)


def test_diesel_multiplier_raises_transport_cost():
    a = scoring.score_one(cand(distance_km=100), Params(), 0.8)
    b = scoring.score_one(cand(distance_km=100), Params(diesel_multiplier=1.4), 0.8)
    assert a["saving_per_tonne"] - b["saving_per_tonne"] == pytest.approx(100 * 4.5 * 0.4)


def test_score_bounds():
    m = scoring.score_one(cand(distance_km=0, disposal=5000), Params(), 0.8)
    assert 0 <= m["score"] <= 100


def test_property_fit():
    assert matching.property_fit(5, 0, 10) == 1.0
    assert matching.property_fit(20, 0, 10) == pytest.approx(math.exp(-3))
    assert matching.property_fit(None, 0, 10) == 0.5


def test_technical_fit_no_spec():
    assert matching.technical_fit({"CaO": 10}, {})[0] == 1.0


def test_timing_seasonal_mismatch():
    sugar = [1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1]
    assert matching.timing([1] * 12, [1] * 12) == 1.0
    assert matching.timing(sugar, [1] * 12) == pytest.approx(6 / 12)
    assert matching.timing([1] * 12, [0] * 12) == 0.0


def test_road_distance():
    assert road_km(0, 0, 0, 1) == pytest.approx(haversine_km(0, 0, 0, 1) * 1.3)
    assert haversine_km(19.07, 72.87, 18.52, 73.85) == pytest.approx(120, abs=10)  # Mumbai-Pune
