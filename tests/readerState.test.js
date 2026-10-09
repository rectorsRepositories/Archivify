const assert = require("node:assert/strict");
const { it } = require("node:test");

/** @returns {object} Isolated Storage-compatible fixture. */
function memoryStorage() {
    const values = new Map();
    return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

it("resumes only the matching EPUB revision while preserving progress across metadata edits", async () => {
    const { progressKey, saveProgress, readProgress } = await import("../client/src/books/readerState.mjs");
    const storage = memoryStorage();
    const book = { id: 4, title: "Original", formats: [{ format: "epub", file_id: 7, size_bytes: 1000, modified_at: 500 }] };
    const cfi = "epubcfi(/6/2!/4/2/1:0)";
    assert.equal(saveProgress(storage, progressKey(book), cfi), true);
    assert.equal(readProgress(storage, progressKey({ ...book, title: "Corrected", indexed_at: 900 })), cfi);
    for (const revision of [{ modified_at: 501 }, { size_bytes: 1200 }, { file_id: 8 }]) {
        const replaced = { ...book, formats: [{ ...book.formats[0], ...revision }] };
        assert.equal(readProgress(storage, progressKey(replaced)), undefined);
    }
    assert.equal(readProgress(storage, progressKey({ ...book, id: 5 })), undefined);
});

it("keeps reading available with blocked storage, invalid JSON, and invalid saved locations", async () => {
    const { saveProgress, readProgress, readSettings, saveSettings } = await import("../client/src/books/readerState.mjs");
    const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); } };
    assert.equal(saveProgress(blocked, "book", "epubcfi(/6/2)"), false);
    assert.equal(readProgress(blocked, "book"), undefined);
    assert.deepEqual(readSettings(blocked), { theme: "paper", fontSize: 100 });
    assert.doesNotThrow(() => saveSettings(blocked, { theme: "night", fontSize: 120 }));
    const storage = memoryStorage();
    for (const value of ["broken JSON", "null", '{"cfi":23}', '{"cfi":"javascript:alert(1)"}', JSON.stringify({ cfi: "epubcfi(" + "x".repeat(8000) })]) {
        storage.setItem("book", value);
        assert.equal(readProgress(storage, "book"), undefined);
    }
});

it("restores valid preferences and falls back independently for invalid theme or font size", async () => {
    const { readSettings, saveSettings } = await import("../client/src/books/readerState.mjs");
    const storage = memoryStorage();
    saveSettings(storage, { theme: "night", fontSize: 140 });
    assert.deepEqual(readSettings(storage), { theme: "night", fontSize: 140 });
    saveSettings(storage, { theme: "unknown", fontSize: 90 });
    assert.deepEqual(readSettings(storage), { theme: "paper", fontSize: 90 });
    saveSettings(storage, { theme: "sepia", fontSize: 1000 });
    assert.deepEqual(readSettings(storage), { theme: "sepia", fontSize: 100 });
});

it("flattens nested chapter navigation while excluding external or active targets and bounding depth", async () => {
    const { chapterOptions } = await import("../client/src/books/readerState.mjs");
    assert.deepEqual(chapterOptions([
        { href: "chapter.xhtml", label: " Part one ", subitems: [{ href: "chapter.xhtml#second", label: "Second" }] },
        { href: " https://example.com ", label: "Remote" }, { href: "//example.com", label: "Remote" },
        { href: "javascript:alert(1)", label: "Active" }, null, { href: "end.xhtml", label: 17 },
    ]), [{ href: "chapter.xhtml", label: "Part one" }, { href: "chapter.xhtml#second", label: "— Second" }, { href: "end.xhtml", label: "Untitled chapter" }]);
    const recursive = { href: "chapter.xhtml", label: "Recursive" };
    recursive.subitems = [recursive];
    assert.equal(chapterOptions([recursive]).length, 21);
});
