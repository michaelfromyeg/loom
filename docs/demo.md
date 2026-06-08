# Demo: real-world use cases

A runnable script lives at
[`examples/demo.sh`](https://github.com/michaelfromyeg/loom/blob/main/examples/demo.sh):

```sh
bash examples/demo.sh
```

It needs Bun (the dev runtime) and this repo; the optional eval step also needs an
authenticated `claude` CLI. Everything else runs offline. Below is the actual output,
annotated.

## 1. A solo dev ships one capability to every harness

You author a plugin once (`loom.yaml` + a `SKILL.md`), with no per-harness JSON, and compile
it to all five harnesses. `install` only touches the harnesses you actually have.

```
com.acme/code-helper: valid (1 components)

Built com.acme/code-helper -> out/
  claude: 3 files (catalog at out/claude)
  codex: 4 files (catalog at out/codex)
  cursor: 3 files (catalog at out/cursor)
  copilot: 3 files (catalog at out/copilot)
  opencode: 2 files (catalog at out/opencode)

  skipped codex: harness not detected
  skipped cursor: harness not detected
  skipped copilot: harness not detected
  skipped opencode: harness not detected
Installed com.acme/code-helper@0.1.0 (project)
  2 artifacts placed
```

## 2. A company curates an internal marketplace

One `marketplace.yaml` packages many plugins into each harness's native catalog. This is the
platform-team workflow.

```
Built marketplace acme-tools (2 plugins) -> market/
  claude: 5 files ...

Claude catalog lists every plugin:
  "name": "code-tools",   "source": "./plugins/code-tools",
  "name": "weather-tools", "source": "./plugins/weather-tools",
```

## 3. Trust before you ship

The publish gate runs static validation + a security scan + the deterministic eval tier,
and computes badges. Signing makes the compiled artifacts tamper-evident.

```
  valid: yes
  scan: clean
  badges: valid, scanned
Publish gate passed.

Signed 2 artifacts -> loom.sig (key kept in .loom/, public key in loom.pub)
signature: valid
tampered artifacts: 0
signed badge verified.

Now tamper with a placed file and re-verify; it must fail:
verify correctly FAILED (tamper detected)
```

## 4. Enterprise managed mode

The same mechanism a solo dev uses, restricted by policy: an org pins installs to its own
namespaces, and a foreign namespace is blocked.

```
install correctly BLOCKED (com.acme not in the com.enterprise allowlist)
```

## 5. Evals against the REAL harness

The headline of the eval system: drive the actual headless Claude and assert over what it
did. Here Loom installs the `code-review` skill into a scratch project, asks Claude to
review a file with a planted bug, parses the live `stream-json` trace, and checks that
Claude read the file and named the bug. It's a real pass, not a mock:

```
Eval: com.acme/sample-plugin:code-review
  claude: PASS
    - reads-before-reviewing: pass
        trace: pass (1/1 samples passed (minPassRate 1))
        output: pass (1/1 samples matched)
```

A harness with no available CLI is reported `UNTESTED` rather than faked. Copilot,
which has no structured trace, degrades its `trace` assertions to `output`.
