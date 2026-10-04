const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { createIgdbClient, matchGame } = require("../src/indexers/igdb");

function response(status, payload) {
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

describe("IGDB client", () => {
    it("requires both an exact normalized title and the matching platform", () => {
        const alternative = {
            name: "Different Catalog Title",
            alternative_names: [{ name: "Alien vs Predator" }],
            platforms: [{ name: "PlayStation 2" }],
        };
        assert.equal(matchGame([alternative], "Alien Versus Predator", "PS2"), alternative);
        assert.equal(matchGame([alternative], "Alien vs Predator", "Nintendo 64"), null);
        assert.equal(matchGame([alternative], "Other", "PS2"), null);
        assert.equal(matchGame([{ name: "Alien vs Predator" }], "Alien vs Predator", "PS2"), null);
    });

    it("reports token failures and missing access tokens", async () => {
        const originalFetch = globalThis.fetch;
        try {
            globalThis.fetch = async () => response(401, {});
            await assert.rejects(createIgdbClient("id", "secret"), /token request failed \(HTTP 401\)/);
            globalThis.fetch = async () => response(200, {});
            await assert.rejects(createIgdbClient("id", "secret"), /did not include an access token/);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("authenticates, escapes search text, and returns a matching game", async () => {
        const originalFetch = globalThis.fetch;
        const calls = [];
        const game = { name: 'Alien";\n EV', platforms: [{ name: "PlayStation 2" }] };
        try {
            globalThis.fetch = async (url, options) => {
                calls.push({ url, options });
                return calls.length === 1
                    ? response(200, { access_token: "test-token" })
                    : response(200, [game]);
            };
            const client = await createIgdbClient("client-id", "client-secret");
            assert.equal(await client.lookup(game.name, "PS2"), game);
            assert.equal(calls[0].url, "https://id.twitch.tv/oauth2/token");
            assert.equal(calls[0].options.method, "POST");
            assert.equal(calls[0].options.body.get("grant_type"), "client_credentials");
            assert.equal(calls[1].url, "https://api.igdb.com/v4/games");
            assert.equal(calls[1].options.headers["Client-ID"], "client-id");
            assert.equal(calls[1].options.headers.Authorization, "Bearer test-token");
            assert.match(calls[1].options.body, /^search "Alien\s+EV"; fields /);
            assert.ok(!calls[1].options.body.includes("\n"));
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("retries one rate limit response and reports persistent search errors", async () => {
        const originalFetch = globalThis.fetch;
        const game = { name: "Game", platforms: [{ name: "Wii" }] };
        let calls = 0;
        try {
            // All responses are local mocks; this also exercises the real retry delay.
            globalThis.fetch = async () => {
                calls++;
                if (calls === 1) return response(200, { access_token: "token" });
                if (calls === 2) return response(429, {});
                return response(200, [game]);
            };
            const client = await createIgdbClient("id", "secret");
            assert.equal(await client.lookup("Game", "Wii"), game);
            assert.equal(calls, 3);

            globalThis.fetch = async () => response(503, {});
            await assert.rejects(client.lookup("Game", "Wii"), /search failed \(HTTP 503\)/);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
