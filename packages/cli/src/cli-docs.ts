import { type CommandDef, renderUsage } from "citty";

type Resolvable<T> = T | (() => T | Promise<T>);

async function resolve<T>(r: Resolvable<T>): Promise<T> {
  return typeof r === "function" ? await (r as () => T | Promise<T>)() : r;
}

/**
 * Render a full Markdown CLI reference straight from the citty command tree, so
 * the docs can never drift from the actual commands -- the same single-source
 * principle Weft applies to manifests, applied to its own CLI.
 */
export async function renderCliReference(main: CommandDef): Promise<string> {
  const out: string[] = [
    "# Weft CLI reference",
    "",
    "_Generated from the CLI definition by `weft docs` -- do not edit by hand._",
    "",
    "## `weft`",
    "",
    "```",
    (await renderUsage(main)).trim(),
    "```",
    "",
  ];

  const subs = main.subCommands ? await resolve(main.subCommands) : {};
  for (const name of Object.keys(subs).sort()) {
    const sub = await resolve(subs[name] as Resolvable<CommandDef>);
    const meta = await resolve(sub.meta);
    out.push(`## \`weft ${name}\``, "");
    if (meta?.description) out.push(meta.description as string, "");
    out.push("```", (await renderUsage(sub, main)).trim(), "```", "");
  }

  return `${out.join("\n")}\n`;
}
