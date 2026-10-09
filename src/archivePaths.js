const path = require("node:path");

const archiveRoot = path.resolve(process.env.ARCHIVE_ROOT || (process.platform === "win32"
    ? path.join(__dirname, "../archive")
    : "/Archive"));

const categoryFolders = {
    music: "Music",
    games: "Games",
    books: "Books",
    pictures: "Pictures",
    videos: "Videos",
};

/**
 * Resolve an indexed file within the current archive root.
 * Uses an in-root indexed path when available, otherwise the category and
 * relative path, so databases copied from another machine remain usable.
 * @param {{category: string, relative_path: string, path?: string}} file Indexed file location.
 * @returns {string|null} Safe absolute path or null for invalid locations.
 */
function resolveArchiveFile(file) {
    const folder = categoryFolders[file.category];
    const parts = file.relative_path?.split(/[\\/]+/);

    if (!folder || !parts?.length || parts.some((part) =>
        !part || part === "." || part === "..")) {
        return null;
    }

    // Indexed absolute paths may come from another machine. The category and
    // relative path identify the file within the archive used by this server.
    const categoryRoot = path.join(archiveRoot, folder);
    // Preserve exact paths for current indexes. Older indexes can fall back to
    // the same relative location in this checkout without serving other roots.
    if (file.path) {
        const indexedPath = path.resolve(file.path);
        const indexedRelative = path.relative(categoryRoot, indexedPath);
        if (indexedRelative && !indexedRelative.startsWith(".." + path.sep)
            && indexedRelative !== ".." && !path.isAbsolute(indexedRelative)) {
            return indexedPath;
        }
    }
    if (parts.some((part) => part.includes(":"))) return null;
    const filePath = path.resolve(categoryRoot, ...parts);
    const relative = path.relative(categoryRoot, filePath);
    if (!relative || relative.startsWith(".." + path.sep) || relative === ".."
        || path.isAbsolute(relative)) {
        return null;
    }
    return filePath;
}

module.exports = { archiveRoot, resolveArchiveFile };
