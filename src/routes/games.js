const { HttpError, sendJson, sendList, parseId, parseInteger, pagination, textFilter } = require("../http");
const games = require("../services/games");

function routeGames(req, res, url) {
    if (url.pathname === "/api/v1/games") {
        const params = url.searchParams;
        const page = pagination(params);
        const result = games.listGames({
            q: textFilter(params, "q"),
            platform: textFilter(params, "platform"),
            genre: textFilter(params, "genre"),
            year: params.has("year") ? parseInteger(params.get("year"), "year", 1000, 9999) : null,
        }, page);
        sendList(req, res, result, page);
        return true;
    }

    const match = /^\/api\/v1\/games\/(\d+)$/.exec(url.pathname);
    if (!match) return false;
    const game = games.getGame(parseId(match[1]));
    if (!game) throw new HttpError(404, "not_found", "Game not found.");
    sendJson(req, res, 200, { data: game });
    return true;
}

module.exports = { routeGames };
