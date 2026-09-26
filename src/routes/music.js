const {
    HttpError,
    sendJson,
    sendList,
    parseId,
    parseInteger,
    optionalId,
    pagination,
    textFilter,
} = require("../http");
const music = require("../services/music");
const { getFile } = require("../services/files");
const { sendIndexedFile } = require("./downloads");
const { sendAlbumDownload } = require("./albumDownload");

function optionalYear(searchParams) {
    return searchParams.has("year")
        ? parseInteger(searchParams.get("year"), "year", 1000, 9999)
        : null;
}

async function sendArtwork(req, res, albumId) {
    const artwork = music.getAlbumArtwork(albumId);

    if (!artwork) {
        throw new HttpError(404, "not_found", "Album not found.");
    }

    if (artwork.artwork_file_id != null) {
        const file = getFile(artwork.artwork_file_id);

        if (file) {
            await sendIndexedFile(req, res, file);
            return;
        }
    }

    if (!artwork.image_data) {
        throw new HttpError(404, "not_found", "Album artwork not found.");
    }

    res.writeHead(200, {
        "Content-Type": artwork.mime_type,
        "Content-Length": artwork.image_data.length,
        "X-Content-Type-Options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : artwork.image_data);
}

async function routeMusic(req, res, url) {
    const pathname = url.pathname;
    const params = url.searchParams;

    if (pathname === "/api/v1/music/artists") {
        const page = pagination(params);
        const result = music.listArtists({ q: textFilter(params, "q") }, page);
        sendList(req, res, result, page);
        return true;
    }

    let match = /^\/api\/v1\/music\/artists\/(\d+)$/.exec(pathname);

    if (match) {
        const artist = music.getArtist(parseId(match[1]));

        if (!artist) {
            throw new HttpError(404, "not_found", "Artist not found.");
        }

        sendJson(req, res, 200, { data: artist });
        return true;
    }

    if (pathname === "/api/v1/music/albums") {
        const page = pagination(params);
        const result = music.listAlbums({
            q: textFilter(params, "q"),
            artistId: optionalId(params, "artist_id"),
            year: optionalYear(params),
            genre: textFilter(params, "genre"),
        }, page);
        sendList(req, res, result, page);
        return true;
    }

    match = /^\/api\/v1\/music\/albums\/(\d+)\/tracks$/.exec(pathname);

    if (match) {
        const albumId = parseId(match[1]);

        if (!music.getAlbum(albumId)) {
            throw new HttpError(404, "not_found", "Album not found.");
        }

        const page = pagination(params);
        sendList(req, res, music.listTracks({ albumId }, page), page);
        return true;
    }

    match = /^\/api\/v1\/music\/albums\/(\d+)\/artwork$/.exec(pathname);

    if (match) {
        await sendArtwork(req, res, parseId(match[1]));
        return true;
    }

    match = /^\/api\/v1\/music\/albums\/(\d+)\/download$/.exec(pathname);

    if (match) {
        await sendAlbumDownload(req, res, parseId(match[1]));
        return true;
    }

    match = /^\/api\/v1\/music\/albums\/(\d+)$/.exec(pathname);

    if (match) {
        const album = music.getAlbum(parseId(match[1]));

        if (!album) {
            throw new HttpError(404, "not_found", "Album not found.");
        }

        sendJson(req, res, 200, { data: album });
        return true;
    }

    if (pathname === "/api/v1/music/tracks") {
        const page = pagination(params);
        const result = music.listTracks({
            q: textFilter(params, "q"),
            albumId: optionalId(params, "album_id"),
            artistId: optionalId(params, "artist_id"),
            year: optionalYear(params),
            genre: textFilter(params, "genre"),
        }, page);
        sendList(req, res, result, page);
        return true;
    }

    match = /^\/api\/v1\/music\/tracks\/(\d+)$/.exec(pathname);

    if (match) {
        const track = music.getTrack(parseId(match[1]));

        if (!track) {
            throw new HttpError(404, "not_found", "Track not found.");
        }

        sendJson(req, res, 200, { data: track });
        return true;
    }

    return false;
}

module.exports = { routeMusic };
