"""FastAPI app: JSON API over nba_api plus the static arcade front end.

Run:  uvicorn backend.server:app --reload   then open http://localhost:8000
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles

from . import nba_data
from .nba_data import NBADataError

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

app = FastAPI(title="Arcade Shot Machine")


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except NBADataError as exc:
        raise HTTPException(status_code=502, detail=f"NBA stats request failed: {exc}")


@app.get("/api/health")
def health():
    return {"ok": True, "source": "nba_api"}


@app.get("/api/players")
def players(q: str = Query("", max_length=60)):
    return nba_data.search_players(q)


@app.get("/api/games")
def games(player_id: int, season: str, season_type: str = "Regular Season"):
    return _call(nba_data.games, player_id, season, season_type)


@app.get("/api/shots")
def shots(player_id: int, season: str, season_type: str = "Regular Season"):
    return {
        "player": {"id": player_id, "name": nba_data.player_name(player_id)},
        "season": season,
        "shots": _call(nba_data.shots, player_id, season, season_type),
    }


@app.get("/api/freethrows")
def freethrows(player_id: int, game_id: str):
    return _call(nba_data.free_throws, player_id, game_id)


@app.get("/api/game")
def game(player_id: int, season: str, game_id: str,
         season_type: str = "Regular Season"):
    data = _call(nba_data.game_replay, player_id, season, game_id, season_type)
    data["player"] = {"id": player_id, "name": nba_data.player_name(player_id)}
    return data


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
