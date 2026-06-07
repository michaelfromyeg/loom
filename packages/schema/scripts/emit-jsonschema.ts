import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allJsonSchemas } from "../src/jsonschema";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "schemas");
mkdirSync(outDir, { recursive: true });

for (const [name, schema] of Object.entries(allJsonSchemas())) {
  const file = join(outDir, `${name.replace(/\./g, "-")}.schema.json`);
  writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
  console.log(`wrote ${file}`);
}
