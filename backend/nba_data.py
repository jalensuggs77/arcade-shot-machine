"""Thin data layer over nba_api (https://github.com/swar/nba_api).

Everything here returns plain JSON-serialisable dicts in the shape the
front end expects, and caches every NBA response on disk so a replay only
hits stats.nba.com once.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

from nba_api.stats.static import players as static_players

CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "cache"
TIMEOUT = 30
# stats.nba.com throttles aggressively; keep consecutive calls apart.
MIN_INTERVAL = 0.6
_last_call = 0.0


class NBADataError(RuntimeError):
    pass


def _throttle() -> None:
    global _last_call
    wait = MIN_INTERVAL - (time.monotonic() - _last_call)
    if wait > 0:
        time.sleep(wait)
    _last_call = time.monotonic()


def _cached(key: str, fetch):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / (re.sub(r"[^A-Za-z0-9_.-]", "_", key) + ".json")
    if path.exists():
        return json.loads(path.read_text())
    _throttle()
    try:
        data = fetch()
    except Exception as exc:  # network errors, NBA blocking, bad JSON...
        raise NBADataError(f"{type(exc).__name__}: {exc}") from exc
    path.write_text(json.dumps(data))
    return data


def _rows(endpoint, name: str) -> list[dict]:
    """Turn one nba_api result set into a list of dicts."""
    for rs in endpoint.get_dict()["resultSets"]:
        if rs["name"] == name:
            return [dict(zip(rs["headers"], row)) for row in rs["rowSet"]]
    return []


def period_length(period: int) -> int:
    return 720 if period <= 4 else 300


def elapsed_seconds(period: int, seconds_remaining: float) -> float:
    """Game seconds elapsed since tip-off (overtime aware)."""
    before = sum(period_length(p) for p in range(1, period))
    return before + period_length(period) - seconds_remaining


# --------------------------------------------------------------------------
# players


def search_players(query: str, limit: int = 15) -> list[dict]:
    query = query.strip()
    found = static_players.find_players_by_full_name(query) if query else []
    # Active players first, then alphabetical.
    found.sort(key=lambda p: (not p["is_active"], p["full_name"]))
    return [
        {"id": p["id"], "name": p["full_name"], "active": p["is_active"]}
        for p in found[:limit]
    ]


def player_name(player_id: int) -> str:
    p = static_players.find_player_by_id(player_id)
    return p["full_name"] if p else str(player_id)


# --------------------------------------------------------------------------
# shots


def _normalise_shot(row: dict) -> dict:
    period = int(row["PERIOD"])
    remaining = int(row["MINUTES_REMAINING"]) * 60 + int(row["SECONDS_REMAINING"])
    return {
        "id": f'{row["GAME_ID"]}-{row["GAME_EVENT_ID"]}',
        "gameId": row["GAME_ID"],
        "gameDate": row["GAME_DATE"],
        "period": period,
        "remaining": remaining,
        "t": elapsed_seconds(period, remaining),
        # LOC_X / LOC_Y are tenths of a foot with the rim at (0, 0).
        "x": int(row["LOC_X"]),
        "y": int(row["LOC_Y"]),
        "made": bool(row["SHOT_MADE_FLAG"]),
        "pts": 3 if row["SHOT_TYPE"].startswith("3") else 2,
        "action": row["ACTION_TYPE"],
        "zone": row["SHOT_ZONE_BASIC"],
        "dist": int(row["SHOT_DISTANCE"]),
        "home": row["HTM"],
        "away": row["VTM"],
    }


def shots(player_id: int, season: str, season_type: str = "Regular Season",
          game_id: str = "") -> list[dict]:
    from nba_api.stats.endpoints import shotchartdetail

    def fetch():
        ep = shotchartdetail.ShotChartDetail(
            team_id=0,
            player_id=player_id,
            # The default ("PTS") only returns made shots; FGA gives all.
            context_measure_simple="FGA",
            season_nullable=season,
            season_type_all_star=season_type,
            game_id_nullable=game_id,
            timeout=TIMEOUT,
        )
        rows = [_normalise_shot(r) for r in _rows(ep, "Shot_Chart_Detail")]
        rows.sort(key=lambda s: (s["gameDate"], s["gameId"], s["t"]))
        return rows

    key = f"shots_{player_id}_{season}_{season_type}_{game_id or 'all'}"
    return _cached(key, fetch)


# --------------------------------------------------------------------------
# games


def games(player_id: int, season: str, season_type: str = "Regular Season") -> list[dict]:
    from nba_api.stats.endpoints import playergamelog

    def fetch():
        ep = playergamelog.PlayerGameLog(
            player_id=player_id,
            season=season,
            season_type_all_star=season_type,
            timeout=TIMEOUT,
        )
        out = [
            {
                "gameId": r["Game_ID"],
                "date": r["GAME_DATE"],
                "matchup": r["MATCHUP"],
                "wl": r["WL"],
                "pts": r["PTS"],
                "fgm": r["FGM"],
                "fga": r["FGA"],
                "fg3m": r["FG3M"],
                "fg3a": r["FG3A"],
            }
            for r in _rows(ep, "PlayerGameLog")
        ]
        out.reverse()  # chronological
        return out

    return _cached(f"games_{player_id}_{season}_{season_type}", fetch)


_CLOCK_RE = re.compile(r"PT(\d+)M([\d.]+)S")


def free_throws(player_id: int, game_id: str) -> list[dict]:
    """Free throws are not in the shot chart; pull them from play-by-play."""
    from nba_api.stats.endpoints import playbyplayv3

    def fetch():
        ep = playbyplayv3.PlayByPlayV3(game_id=game_id, timeout=TIMEOUT)
        out = []
        for a in ep.get_dict()["game"]["actions"]:
            if a.get("personId") != player_id or a.get("actionType") != "Free Throw":
                continue
            m = _CLOCK_RE.match(a.get("clock") or "")
            remaining = int(m.group(1)) * 60 + float(m.group(2)) if m else 0
            period = int(a["period"])
            desc = a.get("description") or ""
            out.append({
                "id": f'{game_id}-ft-{a["actionNumber"]}',
                "period": period,
                "remaining": remaining,
                "t": elapsed_seconds(period, remaining),
                "made": "MISS" not in desc.upper(),
                "desc": desc,
            })
        return out

    return _cached(f"ft_{player_id}_{game_id}", fetch)


def game_replay(player_id: int, season: str, game_id: str,
                season_type: str = "Regular Season") -> dict:
    game_shots = shots(player_id, season, season_type, game_id)
    try:
        fts = free_throws(player_id, game_id)
    except NBADataError:
        fts = None  # replay still works, scoreboard just shows FG points
    try:
        meta = next((g for g in games(player_id, season, season_type)
                     if g["gameId"] == game_id), None)
    except NBADataError:
        meta = None
    return {"shots": game_shots, "freeThrows": fts, "game": meta}
