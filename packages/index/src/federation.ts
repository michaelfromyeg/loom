import type { IndexEntry, IndexFile } from "@michaelfromyeg/loom-schema";

/** The inline server.json shape the MCP Registry serves (subset; spec §10). */
export interface McpServerJson {
  name: string;
  description?: string;
  version: string;
  repository?: { url?: string };
}
export interface McpServerResponse {
  server: McpServerJson;
  _meta?: unknown;
}

type FetchLike = (url: string) => Promise<{ json(): Promise<unknown> }>;

/**
 * Fetch the official MCP Registry's `GET /v0.1/servers` (spec §10). `fetchImpl` is
 * injectable so tests run offline; the live default uses global fetch. We ingest
 * the registry's own scheme rather than reinventing it.
 */
export async function fetchMcpRegistry(
  opts: { baseUrl?: string; limit?: number; fetchImpl?: FetchLike } = {},
): Promise<McpServerResponse[]> {
  const base = opts.baseUrl ?? "https://registry.modelcontextprotocol.io";
  const f = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const res = await f(`${base}/v0.1/servers?limit=${opts.limit ?? 30}`);
  const data = (await res.json()) as { servers?: McpServerResponse[] };
  return data.servers ?? [];
}

/** Map MCP Registry servers into MCP-only index entries. */
export function mcpServersToEntries(servers: McpServerResponse[]): IndexEntry[] {
  return servers.map(({ server }) => ({
    id: server.name,
    source: server.repository?.url ?? "mcp-registry",
    versions: [
      {
        version: server.version,
        ref: server.version,
        sha: "",
        badges: ["valid"],
        harnessCoverage: [],
      },
    ],
  }));
}

/** Merge federated MCP entries into an index and stamp the ingestion. */
export function federate(
  index: IndexFile,
  servers: McpServerResponse[],
  ingestedAt: string,
): IndexFile {
  const federated = [...(index.federated ?? []), { source: "mcp-registry", ingestedAt }];
  return { ...index, plugins: [...index.plugins, ...mcpServersToEntries(servers)], federated };
}
