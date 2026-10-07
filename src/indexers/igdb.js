const PLATFORM_NAMES = {
    ps2: "playstation 2",
    ps1: "playstation",
    psx: "playstation",
    ps3: "playstation 3",
    ps4: "playstation 4",
    ps5: "playstation 5",
    pc: "pc microsoft windows",
};

/**
 * @typedef {object} IgdbGame
 * @property {number} id IGDB game ID.
 * @property {string} name Primary title.
 * @property {Array<{name: string}>} [alternative_names] Alternate titles.
 * @property {Array<{name: string}>} [platforms] Supported platforms.
 * @property {Array<{name: string}>} [genres] Genres.
 * @property {{image_id: string}} [cover] Cover image reference.
 * @property {number} [first_release_date] Unix timestamp in seconds.
 * @property {string} [summary] Game summary.
 * @property {string} [url] IGDB page URL.
 */

function normalized(value) {
    return String(value || "").normalize("NFKD").toLowerCase()
        .replace(/[^a-z0-9]+/g, " ").replace(/\bversus\b/g, "vs").trim();
}

/**
 * Require normalized exact title and platform matches, including alternate titles.
 * @param {IgdbGame[]} results IGDB search candidates.
 * @param {string} title Requested title.
 * @param {string} platform Requested platform name or supported abbreviation.
 * @returns {IgdbGame|null} First matching candidate, if any.
 */
function matchGame(results, title, platform) {
    const wantedTitle = normalized(title);
    const wantedPlatform = PLATFORM_NAMES[normalized(platform).replace(/ /g, "")] || normalized(platform);
    return results.find((result) => {
        const titles = [result.name, ...(result.alternative_names || []).map((item) => item.name)];
        return titles.some((name) => normalized(name) === wantedTitle) &&
            result.platforms?.some((candidate) => normalized(candidate.name) === wantedPlatform);
    }) || null;
}

function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Authenticate with Twitch and create a rate-limited IGDB lookup client.
 * Searches retry once after HTTP 429; other request failures propagate.
 * @param {string} clientId Twitch client ID.
 * @param {string} clientSecret Twitch client secret.
 * @returns {Promise<{lookup(title: string, platform: string): Promise<IgdbGame|null>}>} Search client.
 * @throws {Error} When token acquisition fails or has no access token.
 */
async function createIgdbClient(clientId, clientSecret) {
    const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "client_credentials",
        }),
        signal: AbortSignal.timeout(15000),
    });
    if (!tokenResponse.ok) throw new Error("Twitch token request failed (HTTP " + tokenResponse.status + ")");
    const token = (await tokenResponse.json()).access_token;
    if (!token) throw new Error("Twitch token response did not include an access token");

    let lastRequest = 0;
    /**
     * Search IGDB for an exact normalized title and platform match.
     * @param {string} title Game title; query delimiters are removed.
     * @param {string} platform Platform name or supported abbreviation.
     * @returns {Promise<IgdbGame|null>} Matching game, if any.
     * @throws {Error} When the search request fails after the allowed retry.
     */
    async function lookup(title, platform) {
        const elapsed = Date.now() - lastRequest;
        if (elapsed < 300) await sleep(300 - elapsed);
        lastRequest = Date.now();
        const safeTitle = title.replace(/["\\;\r\n]/g, " ").trim();
        const body =
            'search "' + safeTitle + '"; ' +
            "fields name,alternative_names.name,platforms.name,genres.name,cover.image_id,first_release_date,summary,url; limit 25;";
        let response;
        for (let attempt = 0; attempt < 2; attempt++) {
            response = await fetch("https://api.igdb.com/v4/games", {
                method: "POST",
                headers: {
                    "Client-ID": clientId,
                    Authorization: "Bearer " + token,
                    "Content-Type": "text/plain",
                },
                body,
                signal: AbortSignal.timeout(15000),
            });
            if (response.status !== 429 || attempt === 1) break;
            await sleep(1000);
            lastRequest = Date.now();
        }
        if (!response.ok) throw new Error("IGDB search failed (HTTP " + response.status + ")");
        return matchGame(await response.json(), title, platform);
    }

    return { lookup };
}

module.exports = { createIgdbClient, matchGame };
