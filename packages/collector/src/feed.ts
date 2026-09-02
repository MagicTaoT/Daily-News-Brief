import { createHash } from "node:crypto";

import type { FeedSource } from "@morning-signal/contracts";
import { XMLParser } from "fast-xml-parser";

export interface ParsedFeedItem {
  id: string;
  url: string;
  canonicalUrl: string;
  title: string;
  author: string | null;
  publishedAt: string | null;
  body: string;
  contentHash: string;
  sourceItemId: string | null;
}

type UnknownRecord = Record<string, unknown>;

const parser = new XMLParser({
  attributeNamePrefix: "@",
  cdataPropName: "#cdata",
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: true,
  removeNSPrefix: true,
  textNodeName: "#text",
  trimValues: true,
});

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function values(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return value.map(text).find(Boolean) ?? "";
  }

  const object = record(value);
  if (!object) {
    return "";
  }

  return text(object["#text"]) || text(object["#cdata"]);
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(
    /&(#(?:x[0-9a-f]+|[0-9]+)|[a-z]+);/giu,
    (entity, code: string) => {
      if (code.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      }
      if (code.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
      }
      return named[code.toLowerCase()] ?? entity;
    },
  );
}

export function plainText(value: unknown): string {
  return decodeEntities(text(value).replace(/<[^>]*>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim();
}

function absoluteUrl(value: string, feedUrl: string): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value, feedUrl).toString();
  } catch {
    return null;
  }
}

function canonicalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";

  for (const parameter of [
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
    "utm_campaign",
    "utm_content",
    "utm_medium",
    "utm_source",
    "utm_term",
  ]) {
    url.searchParams.delete(parameter);
  }

  return url.toString();
}

function atomLink(value: unknown, feedUrl: string): string | null {
  const links = values(value);
  const alternate = links.find((link) => {
    const candidate = record(link);
    return candidate?.["@rel"] === "alternate";
  });
  const selected = alternate ?? links[0];
  const object = record(selected);
  return absoluteUrl(
    object ? text(object["@href"]) || text(object) : text(selected),
    feedUrl,
  );
}

function normalizedDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) {
    return null;
  }

  const milliseconds = Date.parse(raw);
  return Number.isNaN(milliseconds)
    ? null
    : new Date(milliseconds).toISOString();
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeItem(
  value: unknown,
  source: FeedSource,
  format: "rss" | "atom",
): ParsedFeedItem | null {
  const item = record(value);
  if (!item) {
    return null;
  }

  const title = plainText(item.title);
  const url =
    format === "atom"
      ? atomLink(item.link, source.feed_url)
      : absoluteUrl(text(item.link), source.feed_url);
  if (!title || !url) {
    return null;
  }

  const canonicalUrl = canonicalizeUrl(url);
  const body =
    plainText(item.encoded) ||
    plainText(item.content) ||
    plainText(item.description) ||
    plainText(item.summary) ||
    title;
  const authorObject = record(item.author);
  const author =
    plainText(authorObject?.name) ||
    plainText(item.creator) ||
    plainText(item.author) ||
    null;
  const sourceItemId =
    plainText(item.guid) || plainText(item.id) || canonicalUrl || null;
  const identity = `${source.id}\0${sourceItemId ?? canonicalUrl}`;
  const contentHash = hash(`${source.id}\0${canonicalUrl}\0${title}\0${body}`);

  return {
    id: `doc-${hash(identity).slice(0, 32)}`,
    url,
    canonicalUrl,
    title,
    author,
    publishedAt:
      normalizedDate(item.pubDate) ??
      normalizedDate(item.published) ??
      normalizedDate(item.updated) ??
      normalizedDate(item.date),
    body,
    contentHash: `sha256:${contentHash}`,
    sourceItemId,
  };
}

export function parseFeed(xml: string, source: FeedSource): ParsedFeedItem[] {
  const root = record(parser.parse(xml));
  if (!root) {
    throw new Error("Feed did not contain an XML document.");
  }

  const rss = record(root.rss);
  const rssChannel = record(rss?.channel);
  const rdf = record(root.RDF);
  const atom = record(root.feed);
  let format: "rss" | "atom";
  let items: unknown[];

  if (rssChannel) {
    format = "rss";
    items = values(rssChannel.item);
  } else if (rdf) {
    format = "rss";
    items = values(rdf.item);
  } else if (atom) {
    format = "atom";
    items = values(atom.entry);
  } else {
    throw new Error("Unsupported feed: expected RSS, RDF or Atom.");
  }

  if (source.format !== "auto" && source.format !== format) {
    throw new Error(
      `Feed format mismatch: configured ${source.format}, received ${format}.`,
    );
  }

  return items
    .map((item) => normalizeItem(item, source, format))
    .filter((item): item is ParsedFeedItem => item !== null);
}
