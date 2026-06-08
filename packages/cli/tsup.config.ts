import { defineConfig } from "tsup";
import { weftTsup } from "../../tsup.base";

export default defineConfig(
  weftTsup({
    banner: { js: "#!/usr/bin/env node" },
  }),
);
