import type { HarnessAdapter } from "@michaelfromyeg/loom-adapter-kit";
import type { Target } from "@michaelfromyeg/loom-schema";

/**
 * Adapters registered by Target (spec §7). Core depends only on the adapter-kit
 * interface; the CLI (or an embedding app) registers concrete adapters, keeping
 * the dependency direction one-way and letting community adapters slot in.
 */
export class AdapterRegistry {
  private readonly adapters = new Map<Target, HarnessAdapter>();

  register(adapter: HarnessAdapter): this {
    this.adapters.set(adapter.target, adapter);
    return this;
  }

  get(target: Target): HarnessAdapter | undefined {
    return this.adapters.get(target);
  }

  has(target: Target): boolean {
    return this.adapters.has(target);
  }

  get targets(): Target[] {
    return [...this.adapters.keys()];
  }
}
