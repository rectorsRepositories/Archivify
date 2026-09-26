const PLATFORM_NAMES = {
    ps2: "playstation 2",
    ps1: "playstation",
    psx: "playstation",
    ps3: "playstation 3",
    ps4: "playstation 4",
    ps5: "playstation 5",
    pc: "pc microsoft windows",
};

function normalized(value) {
    return String(value || "").normalize("NFKD").toLowerCase()
        .replace(/[^a-z0-9]+/g, " ").replace(/\bversus\b/g, "vs").trim();
}

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
