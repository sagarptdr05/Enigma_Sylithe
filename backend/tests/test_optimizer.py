from app.engines.optimizer import optimize


def m(ws, dm, sup, dem, saving, co2=0.5):
    return dict(waste_stream_id=ws, demand_id=dm, src_id=ws, dst_id=100 + dm, waste_name="w", material="m",
                supply=sup, demand=dem, saving_per_tonne=saving, co2_per_tonne=co2, score=80)


def test_supply_goes_to_best_buyer():
    res = optimize([m(1, 1, 100, 100, 500), m(1, 2, 100, 100, 900)])
    assert res["allocations"][0]["demand_id"] == 2
    assert res["allocations"][0]["monthly_tonnes"] == 100
    assert res["total_saving_per_year"] == 100 * 12 * 900


def test_demand_cap_respected():
    res = optimize([m(1, 1, 100, 30, 500), m(2, 1, 100, 30, 400)])
    assert sum(a["monthly_tonnes"] for a in res["allocations"]) == 30


def test_empty():
    assert optimize([])["allocations"] == []
