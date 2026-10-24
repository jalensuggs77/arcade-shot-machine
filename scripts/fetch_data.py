"""Pre-fetch a player's season into data/cache so the app works offline later.

    python -m scripts.fetch_data "Stephen Curry" 2015-16 [--playoffs] [--free-throws]
"""

import argparse
import sys

from backend import nba_data


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("player", help='full or partial name, e.g. "Stephen Curry"')
    ap.add_argument("season", help="e.g. 2015-16")
    ap.add_argument("--playoffs", action="store_true")
    ap.add_argument("--free-throws", action="store_true",
                    help="also fetch play-by-play free throws for every game (one request per game)")
    args = ap.parse_args()

    found = nba_data.search_players(args.player, limit=1)
    if not found:
        print(f"no player matches {args.player!r}", file=sys.stderr)
        return 1
    player = found[0]
    season_type = "Playoffs" if args.playoffs else "Regular Season"
    print(f"{player['name']} ({player['id']}) {args.season} {season_type}")

    try:
        shots = nba_data.shots(player["id"], args.season, season_type)
        games = nba_data.games(player["id"], args.season, season_type)
    except nba_data.NBADataError as exc:
        print(f"request failed: {exc}", file=sys.stderr)
        return 1
    print(f"  {len(shots)} shots across {len(games)} games")
    for g in sorted(games, key=lambda g: -g["pts"])[:5]:
        print(f"  {g['date']}  {g['matchup']:<12} {g['pts']:>3} PTS  3PT {g['fg3m']}/{g['fg3a']}  {g['gameId']}")

    if args.free_throws:
        for i, g in enumerate(games, 1):
            try:
                nba_data.free_throws(player["id"], g["gameId"])
            except nba_data.NBADataError as exc:
                print(f"  free throws for {g['gameId']} failed: {exc}", file=sys.stderr)
            print(f"\r  free throws {i}/{len(games)}", end="", flush=True)
        print()
    print(f"cached in {nba_data.CACHE_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
