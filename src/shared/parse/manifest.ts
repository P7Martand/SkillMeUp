export interface MarketplacePlugin {
  name: string;
  source: string;            // normalized: leading "./" stripped
  description?: string;
  version?: string;
  author?: string | { name?: string };
  commands?: string[];
  agents?: string[];
  skills?: string[];
}

export interface ParsedMarketplace {
  name?: string;
  plugins: MarketplacePlugin[];
}

export interface ParsedPlugin {
  name?: string;
  description?: string;
  version?: string;
  author?: string | { name?: string };
  commands?: string[];
  agents?: string[];
  skills?: string[];
}

/** Parse a marketplace.json. Returns null if the text is not valid JSON. */
export function parseMarketplaceJson(text: string): ParsedMarketplace | null {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const plugins: MarketplacePlugin[] = [];
  for (const p of Array.isArray(raw?.plugins) ? raw.plugins : []) {
    if (!p || typeof p.name !== 'string') continue;
    const source = typeof p.source === 'string' ? p.source.replace(/^\.\//, '') : '';
    plugins.push({
      name: p.name,
      source,
      description: typeof p.description === 'string' ? p.description : undefined,
      version: typeof p.version === 'string' ? p.version : undefined,
      author: p.author,
      commands: manifestPluginNames(p.commands),
      agents: manifestPluginNames(p.agents),
      skills: manifestPluginNames(p.skills)
    });
  }
  return { name: typeof raw?.name === 'string' ? raw.name : undefined, plugins };
}

/** Parse a plugin.json. Returns null if the text is not valid JSON. */
export function parsePluginJson(text: string): ParsedPlugin | null {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  return {
    name: typeof raw?.name === 'string' ? raw.name : undefined,
    description: typeof raw?.description === 'string' ? raw.description : undefined,
    version: typeof raw?.version === 'string' ? raw.version : undefined,
    author: raw?.author,
    commands: manifestPluginNames(raw?.commands),
    agents: manifestPluginNames(raw?.agents),
    skills: manifestPluginNames(raw?.skills)
  };
}

/** Normalize a commands/agents/skills field that may be string[] or {name}[]. */
export function manifestPluginNames(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .map((x) => (typeof x === 'string' ? x : (x && typeof x === 'object' ? (x as any).name ?? '' : '')))
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
}
