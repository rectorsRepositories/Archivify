const path = require("node:path");
const { createHash } = require("node:crypto");
const { TextDecoder } = require("node:util");
const yauzl = require("yauzl");
const { SaxesParser } = require("saxes");

const DC = "http://purl.org/dc/elements/1.1/";
const XML_LIMIT = 8 * 1024 * 1024;
const COVER_LIMIT = 16 * 1024 * 1024;
const CONTENT_LIMIT = 64 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/**
 * @typedef {object} BookMetadata
 * @property {string|null} title Embedded title; indexer supplies a filename fallback.
 * @property {string|null} subtitle Subtitle refinement.
 * @property {string|null} sort_title Explicit title file-as value.
 * @property {string|null} description Embedded description.
 * @property {string|null} publisher Publisher credit.
 * @property {string|null} publication_date EPUB publication date, preserved as text.
 * @property {number|null} publication_year Derived EPUB publication year.
 * @property {number|null} original_publication_year Explicit original publication year.
 * @property {string|null} series_name Named series.
 * @property {number|null} series_position Position within the series.
 * @property {number|null} page_count Explicit page count, never inferred from markers.
 * @property {string|null} page_count_source Origin of the explicit page count.
 * @property {number|null} page_marker_count Navigation page boundaries, when available.
 * @property {number|null} word_count Approximate linear body word count.
 * @property {string|null} rights Rights statement.
 * @property {string|null} epub_version Package version.
 * @property {string|null} layout Rendition layout metadata.
 * @property {{name: string, sort_name: string|null, role: string, position: number, authority_id: string|null}[]} contributors Ordered credits.
 * @property {{scheme: string, value: string, source: string}[]} identifiers Identifiers with provenance.
 * @property {{name: string, vocabulary: string}[]} subjects Subject terms.
 * @property {string[]} languages Language codes.
 * @property {{raw: object[], sources: Object<string, string>, warnings?: string[]}} metadata Unmodeled fields, origins, and optional extraction warnings.
 * @property {{mimeType: string, imageData: Buffer, checksum: string}|null} artwork Cached raster image.
 */

/**
 * @typedef {object} XmlNode
 * @property {string} name Local element name.
 * @property {string} uri Namespace URI.
 * @property {Object<string, string>} attrs Attributes by qualified and local names.
 * @property {Array<XmlNode|string>} children Ordered element and text children.
 */

/**
 * Parse bounded XML without resolving external DTDs or expanding custom entities.
 * Simple XHTML doctypes are accepted; internal subsets are rejected.
 * @param {Buffer|string} input UTF-8 or BOM-marked UTF-16 XML.
 * @returns {XmlNode} Document element.
 * @throws {Error} For malformed XML, internal DTDs, or excessive nesting/nodes.
 */
function parseXml(input) {
    let xml = input;
    if (Buffer.isBuffer(input)) {
        const encoding = input[0] === 0xff && input[1] === 0xfe ? "utf-16le"
            : input[0] === 0xfe && input[1] === 0xff ? "utf-16be" : "utf-8";
        xml = new TextDecoder(encoding, { fatal: true }).decode(input);
    }
    if (Buffer.byteLength(xml) > XML_LIMIT) throw new Error("XML exceeds the metadata size limit.");
    const parser = new SaxesParser({ xmlns: true });
    const stack = [];
    let root;
    let nodes = 0;
    parser.on("doctype", (doctype) => {
        if (doctype.includes("[")) throw new Error("XML internal DTDs are not supported.");
    });
    parser.on("opentag", (tag) => {
        if (++nodes > 100000 || stack.length >= 100) throw new Error("XML structure exceeds limits.");
        const attrs = {};
        for (const attr of Object.values(tag.attributes)) {
            attrs[attr.name] = attr.value;
            if (!(attr.local in attrs)) attrs[attr.local] = attr.value;
        }
        const node = { name: tag.local, uri: tag.uri, attrs, children: [] };
        if (stack.length) stack.at(-1).children.push(node);
        else root = node;
        stack.push(node);
    });
    parser.on("closetag", () => stack.pop());
    const append = (value) => { if (stack.length) stack.at(-1).children.push(value); };
    parser.on("text", append);
    parser.on("cdata", append);
    parser.write(xml).close();
    if (!root) throw new Error("XML document has no root element.");
    return root;
}

/** @param {XmlNode} node Element. @param {string} name Local name. @returns {XmlNode[]} Direct matching children. */
function children(node, name) {
    return node.children.filter((child) => typeof child !== "string" && child.name === name);
}

/** @param {XmlNode|string} node Element or text. @returns {string} Normalized text content. */
function text(node) {
    return (typeof node === "string" ? node : node.children.map(text).join(" ")).replace(/\s+/g, " ").trim();
}

/** @param {XmlNode} node Root. @param {string} name Local name. @returns {XmlNode[]} All matching descendants, including root. */
function descendants(node, name) {
    return [ ...(node.name === name ? [node] : []),
        ...node.children.filter((child) => typeof child !== "string").flatMap((child) => descendants(child, name)) ];
}

/**
 * Resolve a publication-relative reference without accessing disk or remote URLs.
 * @param {string} base Archive member containing the reference.
 * @param {string} href Relative URL, optionally containing a fragment.
 * @returns {string} Normalized ZIP member path.
 * @throws {Error} For remote, absolute, malformed, or escaping references.
 */
function memberPath(base, href) {
    const reference = decodeURIComponent(href.split(/[?#]/)[0]);
    if (!reference || /[\\\0:]/.test(reference) || reference.startsWith("/")) {
        throw new Error("Invalid EPUB resource reference.");
    }
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(base), reference));
    if (resolved === ".." || resolved.startsWith("../")) throw new Error("EPUB resource escapes its container.");
    return resolved;
}

/**
 * Open a ZIP and enumerate its directory lazily; never extract files to disk.
 * @param {string} filePath EPUB path.
 * @returns {Promise<{zip: object, entries: Map<string, object>, read: function(string, number): Promise<Buffer>}>} Bounded member reader.
 */
async function openPublication(filePath) {
    const zip = await new Promise((resolve, reject) => yauzl.open(filePath,
        { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true },
        (error, value) => error ? reject(error) : resolve(value)));
    const entries = new Map();
    // Keep a listener throughout the lifetime: stream errors can also close a ZIP.
    let zipError;
    zip.on("error", (error) => { zipError = error; });
    try {
        await new Promise((resolve, reject) => {
            const fail = (error) => { cleanup(); reject(error); };
            const cleanup = () => { zip.removeListener("error", fail); zip.removeListener("entry", entry); };
            const entry = (value) => {
                if (entries.size >= 20000 || entries.has(value.fileName)) return fail(new Error("Invalid EPUB ZIP directory."));
                entries.set(value.fileName, value);
                zip.readEntry();
            };
            zip.once("end", () => { cleanup(); resolve(); });
            zip.on("error", fail);
            zip.on("entry", entry);
            zip.readEntry();
        });
        let total = 0;
        return { zip, entries, async read(name, limit = XML_LIMIT) {
            if (zipError) throw zipError;
            const entry = entries.get(name);
            if (!entry) throw new Error("Missing EPUB resource: " + name);
            if (entry.uncompressedSize > limit || total + entry.uncompressedSize > CONTENT_LIMIT) {
                throw new Error("EPUB resource exceeds size limits: " + name);
            }
            const stream = await new Promise((resolve, reject) => zip.openReadStream(entry,
                (error, value) => error ? reject(error) : resolve(value)));
            const chunks = [];
            let size = 0;
            for await (const chunk of stream) {
                size += chunk.length;
                total += chunk.length;
                if (size > limit || total > CONTENT_LIMIT) {
                    stream.destroy();
                    throw new Error("EPUB decompressed data exceeds size limits.");
                }
                chunks.push(chunk);
            }
            return Buffer.concat(chunks);
        } };
    } catch (error) {
        zip.close();
        throw error;
    }
}

/**
 * Normalize and checksum-validate an ISBN-10 or ISBN-13.
 * @param {string} value Declared identifier.
 * @returns {string|null} Canonical ISBN, or null for invalid values.
 */
function normalizeIsbn(value) {
    const isbn = value.replace(/^urn:isbn:/i, "").replace(/[\s-]/g, "").toUpperCase();
    if (/^\d{9}[\dX]$/.test(isbn)) {
        const sum = [...isbn].reduce((total, digit, i) => total + (digit === "X" ? 10 : Number(digit)) * (10 - i), 0);
        if (sum % 11 === 0) return isbn;
    }
    if (/^97[89]\d{10}$/.test(isbn)) {
        const sum = [...isbn].reduce((total, digit, i) => total + Number(digit) * (i % 2 ? 3 : 1), 0);
        if (sum % 10 === 0) return isbn;
    }
    return null;
}

/**
 * Classify an embedded identifier without guessing arbitrary numeric IDs as ISBNs.
 * @param {string} value Raw identifier.
 * @param {string} [scheme] EPUB identifier scheme.
 * @param {string} [source] Metadata source.
 * @returns {{scheme: string, value: string, source: string}} Identifier with provenance.
 */
function identifier(value, scheme = "", source = "epub") {
    value = value.trim();
    const gutenberg = /^https?:\/\/(?:www\.)?gutenberg\.org\/(?:ebooks\/)?(\d+)\/?$/i.exec(value);
    if (gutenberg || /^gutenberg$/i.test(scheme) && /^\d+$/.test(value)) {
        return { scheme: "gutenberg", value: (gutenberg?.[1] || value).replace(/^0+(?=\d)/, ""), source };
    }
    const isbn = normalizeIsbn(value);
    if (isbn && (!scheme || /isbn/i.test(scheme) || /^urn:isbn:/i.test(value))) {
        return { scheme: isbn.length === 10 ? "isbn10" : "isbn13", value: isbn, source };
    }
    return { scheme: /isbn/i.test(scheme) || /^urn:isbn:/i.test(value) ? "invalid_isbn" : scheme.toLowerCase() || (/^urn:uuid:/i.test(value) ? "uuid" : "other"), value, source };
}

/** @param {string|null|undefined} value Date text. @returns {number|null} Four-digit leading year, when present. */
function dateYear(value) {
    return /^\d{4}(?:-|$)/.test(value || "") ? Number(value.slice(0, 4)) || null : null;
}

/**
 * Parse package metadata, preserving raw fields and field origins for later enrichment.
 * @param {XmlNode} pkg OPF package document.
 * @returns {BookMetadata} Normalized bibliographic metadata and relationship arrays.
 */
function packageMetadata(pkg) {
    if (pkg.name !== "package") throw new Error("EPUB package document is invalid.");
    const metadata = children(pkg, "metadata")[0];
    if (!metadata) throw new Error("EPUB package metadata is missing.");
    const dc = (name) => children(metadata, name).filter((node) => node.uri === DC);
    const metas = children(metadata, "meta");
    const refine = (node, property) => metas.find((meta) => meta.attrs.refines === "#" + node.attrs.id && meta.attrs.property === property);
    const property = (name) => {
        const node = metas.find((meta) => !meta.attrs.refines && (meta.attrs.property === name || meta.attrs.name === name));
        return node ? node.attrs.content || text(node) || null : null;
    };
    const titles = dc("title");
    const main = titles.find((node) => text(refine(node, "title-type") || "") === "main") || titles[0];
    const subtitle = titles.find((node) => text(refine(node, "title-type") || "") === "subtitle");
    const collection = metas.find((node) => node.attrs.property === "belongs-to-collection" &&
        text(refine(node, "collection-type") || "") === "series");
    const value = (name) => dc(name).map(text).filter(Boolean).join("; ") || null;
    const publicationDate = text(dc("date").find((node) => !node.attrs.event || node.attrs.event === "publication") || "") || null;
    const pageCount = Number(property("schema:numberOfPages") || property("page-count"));
    const seriesPosition = collection ? text(refine(collection, "group-position") || "") : property("calibre:series_index");
    const fields = {
        title: main ? text(main) || null : null,
        subtitle: subtitle ? text(subtitle) || null : null,
        sort_title: main ? text(refine(main, "file-as") || "") || null : null,
        description: value("description"), publisher: value("publisher"),
        publication_date: publicationDate, publication_year: dateYear(publicationDate),
        original_publication_year: dateYear(property("original-publication-year")),
        series_name: collection ? text(collection) : property("calibre:series"),
        series_position: seriesPosition != null && seriesPosition !== "" && Number.isFinite(Number(seriesPosition)) && Number(seriesPosition) >= 0 ? Number(seriesPosition) : null,
        page_count: Number.isSafeInteger(pageCount) && pageCount > 0 ? pageCount : null,
        page_count_source: Number.isSafeInteger(pageCount) && pageCount > 0 ? "epub_metadata" : null,
        page_marker_count: null, word_count: null,
        rights: value("rights"), epub_version: pkg.attrs.version || null,
        layout: property("rendition:layout"),
    };
    const contributors = [...dc("creator"), ...dc("contributor")].map((node, position) => ({
        name: text(node), sort_name: node.attrs["file-as"] || text(refine(node, "file-as") || "") || null,
        role: node.attrs.role || text(refine(node, "role") || "") || (node.name === "creator" ? "aut" : "ctb"),
        position, authority_id: text(refine(node, "identifier") || "") || null,
    })).filter((node) => node.name);
    const identifiers = dc("identifier").filter((node) => text(node)).map((node) => {
        const type = refine(node, "identifier-type");
        const scheme = node.attrs.scheme || (type?.attrs.scheme === "onix:codelist5"
            ? ({ "02": "isbn10", "15": "isbn13" })[text(type)] || "" : type ? text(type) : "");
        return identifier(text(node), scheme);
    });
    const raw = metadata.children.filter((node) => typeof node !== "string").map((node) =>
        ({ name: node.name, namespace: node.uri, attributes: node.attrs, value: text(node) }));
    const sources = Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null).map(([key]) => [key, "epub"]));
    for (const key of ["contributors", "identifiers", "subjects", "languages"]) sources[key] = "epub";
    return { ...fields, contributors, identifiers,
        subjects: dc("subject").map((node) => ({ name: text(node), vocabulary: node.attrs.scheme || "" })).filter((node) => node.name),
        languages: [...new Set(dc("language").map((node) => text(node).toLowerCase()).filter(Boolean))],
        metadata: { raw, sources },
        artwork: null,
    };
}

/**
 * Extract EPUB 2/3 package metadata, a raster cover, page markers, and body word count.
 * Unsupported SVG covers and optional navigation/content errors become warnings.
 * @param {string} filePath EPUB file under the configured archive root.
 * @returns {Promise<BookMetadata>} Normalized metadata, artwork, and provenance.
 * @throws {Error} For invalid ZIP/package metadata or bounded-read violations.
 */
async function readEpubMetadata(filePath) {
    const publication = await openPublication(filePath);
    const { read, entries, zip } = publication;
    try {
        const container = parseXml(await read("META-INF/container.xml"));
        const rootfile = descendants(container, "rootfile").find((node) => node.attrs["media-type"] === "application/oebps-package+xml") || descendants(container, "rootfile")[0];
        if (!rootfile) throw new Error("EPUB container has no package document.");
        const opfPath = memberPath("container.xml", rootfile.attrs["full-path"] || "");
        const pkg = parseXml(await read(opfPath));
        const details = packageMetadata(pkg);
        const manifest = children(children(pkg, "manifest")[0] || { children: [] }, "item");
        const warnings = [];
        details.metadata.warnings = warnings;
        const properties = (item) => (item.attrs.properties || "").split(/\s+/);
        const legacyCover = details.metadata.raw.find((node) => node.name === "meta" && node.attributes.name === "cover")?.attributes.content;
        const cover = manifest.find((item) => properties(item).includes("cover-image")) || manifest.find((item) => item.attrs.id === legacyCover);
        if (cover) {
            try {
                const mimeType = cover.attrs["media-type"];
                if (!IMAGE_TYPES.has(mimeType)) throw new Error("Cover is not a supported raster image.");
                const imageData = await read(memberPath(opfPath, cover.attrs.href || ""), COVER_LIMIT);
                details.artwork = { mimeType, imageData, checksum: createHash("sha256").update(imageData).digest("hex") };
            } catch (error) { warnings.push("Cover: " + error.message); }
        }
        const nav = manifest.find((item) => properties(item).includes("nav")) || manifest.find((item) => item.attrs["media-type"] === "application/x-dtbncx+xml");
        if (nav) {
            try {
                const document = parseXml(await read(memberPath(opfPath, nav.attrs.href || "")));
                const pageList = descendants(document, "nav").find((node) => (node.attrs.type || "").split(/\s+/).includes("page-list")) || descendants(document, "pageList")[0];
                if (pageList) details.page_marker_count = descendants(pageList, pageList.name === "pageList" ? "pageTarget" : "a").length;
            } catch (error) { warnings.push("Navigation: " + error.message); }
        }
        let words = 0;
        const spine = children(children(pkg, "spine")[0] || { children: [] }, "itemref");
        try {
            const seen = new Set();
            for (const ref of spine) {
                if (ref.attrs.linear === "no") continue;
                const item = manifest.find((entry) => entry.attrs.id === ref.attrs.idref);
                if (!item || item.attrs["media-type"] !== "application/xhtml+xml") continue;
                const name = memberPath(opfPath, item.attrs.href || "");
                if (seen.has(name)) continue;
                seen.add(name);
                const document = parseXml(await read(name));
                const body = descendants(document, "body")[0];
                if (!body) continue;
                const bodyText = (node) => typeof node === "string" ? node
                    : ["script", "style", "nav"].includes(node.name) ? "" : node.children.map(bodyText).join(" ");
                words += (bodyText(body).match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || []).length;
            }
            if (seen.size) details.word_count = words;
        } catch (error) { warnings.push("Word count: " + error.message); }
        if (entries.has("META-INF/encryption.xml")) warnings.push("Publication contains encrypted resources; reader support is not guaranteed.");
        for (const field of ["word_count", "page_marker_count"]) {
            if (details[field] != null) details.metadata.sources[field] = "epub_content";
        }
        return details;
    } finally {
        zip.close();
    }
}

module.exports = { readEpubMetadata, normalizeIsbn, identifier, dateYear, parseXml, memberPath };
