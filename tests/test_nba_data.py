"""Offline tests for the nba_api normalisation layer (no network needed)."""

import pytest

from backend import nba_data


class FakeEndpoint:
    def __init__(self, payload):
        self.payload = payload

    def get_dict(self):
        return self.payload


SHOT_HEADERS = [
    "GRID_TYPE", "GAME_ID", "GAME_EVENT_ID", "PLAYER_ID", "PLAYER_NAME", "TEAM_ID",
    "TEAM_NAME", "PERIOD", "MINUTES_REMAINING", "SECONDS_REMAINING", "EVENT_TYPE",
    "ACTION_TYPE", "SHOT_TYPE", "SHOT_ZONE_BASIC", "SHOT_ZONE_AREA", "SHOT_ZONE_RANGE",
    "SHOT_DISTANCE", "LOC_X", "LOC_Y", "SHOT_ATTEMPTED_FLAG", "SHOT_MADE_FLAG",
    "GAME_DATE", "HTM", "VTM",
]


def shot_row(event_id, period, mins, secs, made, shot_type="3PT Field Goal", x=-120, y=210):
    return ["Shot Chart Detail", "0021500001", event_id, 201939, "Stephen Curry", 1610612744,
            "Golden State Warriors", period, mins, secs, "Made Shot" if made else "Missed Shot",
            "Pullup Jump shot", shot_type, "Above the Break 3", "Left Side Center(LC)",
            "24+ ft.", 25, x, y, 1, int(made), "20151027", "GSW", "NOP"]


@pytest.fixture(autouse=True)
def tmp_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(nba_data, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(nba_data, "MIN_INTERVAL", 0)


def test_elapsed_seconds_handles_overtime():
    assert nba_data.elapsed_seconds(1, 720) == 0
    assert nba_data.elapsed_seconds(4, 0) == 2880
    assert nba_data.elapsed_seconds(5, 300) == 2880
    assert nba_data.elapsed_seconds(6, 150) == 2880 + 300 + 150


def test_shots_are_normalised_sorted_and_cached(monkeypatch):
    from nba_api.stats.endpoints import shotchartdetail

    calls = []

    def fake(**kwargs):
        calls.append(kwargs)
        return FakeEndpoint({"resultSets": [{"name": "Shot_Chart_Detail", "headers": SHOT_HEADERS, "rowSet": [
            shot_row(30, 2, 5, 10, True),
            shot_row(7, 1, 11, 2, False, "2PT Field Goal", 0, 5),
        ]}]})

    monkeypatch.setattr(shotchartdetail, "ShotChartDetail", fake)
    shots = nba_data.shots(201939, "2015-16")
    assert [s["id"] for s in shots] == ["0021500001-7", "0021500001-30"]
    first, second = shots
    assert first == {**first, "period": 1, "remaining": 662, "t": 58, "made": False, "pts": 2, "x": 0, "y": 5}
    assert second["t"] == 720 + 720 - 310 and second["pts"] == 3 and second["made"]
    # all attempts, not just makes
    assert calls[0]["context_measure_simple"] == "FGA"
    # second call is served from the disk cache
    nba_data.shots(201939, "2015-16")
    assert len(calls) == 1


def test_free_throws_from_play_by_play(monkeypatch):
    from nba_api.stats.endpoints import playbyplayv3

    actions = [
        {"actionNumber": 10, "period": 1, "clock": "PT05M32.00S", "personId": 201939,
         "actionType": "Free Throw", "description": "Curry Free Throw 1 of 2 (3 PTS)"},
        {"actionNumber": 11, "period": 1, "clock": "PT05M32.00S", "personId": 201939,
         "actionType": "Free Throw", "description": "MISS Curry Free Throw 2 of 2"},
        {"actionNumber": 12, "period": 1, "clock": "PT05M20.00S", "personId": 2544,
         "actionType": "Free Throw", "description": "Someone else"},
    ]
    monkeypatch.setattr(playbyplayv3, "PlayByPlayV3",
                        lambda **kw: FakeEndpoint({"game": {"actions": actions}}))
    fts = nba_data.free_throws(201939, "0021500001")
    assert [f["made"] for f in fts] == [True, False]
    assert fts[0]["t"] == 720 - 332


def test_network_errors_become_nba_data_error(monkeypatch):
    from nba_api.stats.endpoints import shotchartdetail

    def boom(**kwargs):
        raise ConnectionError("blocked")

    monkeypatch.setattr(shotchartdetail, "ShotChartDetail", boom)
    with pytest.raises(nba_data.NBADataError):
        nba_data.shots(201939, "2015-16")
