import { defineConfig } from "tsup";
import { loomTsup } from "../../tsup.base";

export default defineConfig(
  loomTsup({
    banner: { js: "#!/usr/bin/env node" },
  }),
);
