import {
  type Badge,
  type IndexEntry,
  IndexFile,
  type IndexVersion,
} from "@michaelfromyeg/weft-schema";

/** Parse + validate a serialized index. */
export function loadIndex(text: string): IndexFile {
  return IndexFile.parse(JSON.parse(text));
}

export function findPlugin(index: IndexFile, id: string): IndexEntry | undefined {
  return index.plugins.find((p) => p.id === id);
}

/** The last-listed version of an entry (publish order); undefined when none. */
export function latestVersion(entry: IndexEntry): IndexVersion | undefined {
  return entry.versions.at(-1);
}

/** Entries whose latest version carries a given badge. */
export function pluginsWithBadge(index: IndexFile, badge: Badge): IndexEntry[] {
  return index.plugins.filter((p) => latestVersion(p)?.badges.includes(badge));
}
