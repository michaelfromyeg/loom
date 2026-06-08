# Loom CLI reference

_Generated from the CLI definition by `loom docs` -- do not edit by hand._

## `loom`

```
Author once, compile to every coding-agent harness. (loom v0.1.0)

USAGE `loom init|validate|build|install|uninstall|update|import|eval|publish|sign|verify|index|docs`

COMMANDS

       `init`    Scaffold a new plugin (loom.yaml + a sample skill)                               
   `validate`    Statically validate a plugin (the valid badge)                                   
      `build`    Compile a plugin (or a marketplace of plugins) to harness manifests              
    `install`    Compile + place a plugin into a harness scope, write loom.lock                   
  `uninstall`    Remove everything install placed (from loom.lock) and delete the lockfile        
     `update`    Re-resolve refs, recompile, and re-place only artifacts whose hash changed       
     `import`    Reverse-compile an existing native plugin/marketplace into a Loom plugin         
       `eval`    Run a component's evals against the real harnesses (reports UNTESTED honestly)   
    `publish`    Run the deterministic publish gate (static valid + trace/output evals)           
       `sign`    Sign loom.lock's artifact set (ed25519) -> loom.sig + loom.pub (the signed badge)
     `verify`    Verify loom.sig against loom.lock and the on-disk artifacts                      
      `index`    Build a metadata index from plugin dirs (optionally federating the MCP Registry) 
       `docs`    Print the full CLI reference (a CLI map), generated from the command tree        

Use `loom <command> --help` for more information about a command.
```

## `loom build`

Compile a plugin (or a marketplace of plugins) to harness manifests

```
Compile a plugin (or a marketplace of plugins) to harness manifests (loom build v0.1.0)

USAGE `loom build [OPTIONS] [DIR]`

ARGUMENTS

  `DIR="."`    Plugin or marketplace directory    

OPTIONS

  `--out=".loom-out"`    Output directory                                 
           `--target`    Comma-separated targets (default: all registered)
```

## `loom docs`

Print the full CLI reference (a CLI map), generated from the command tree

```
Print the full CLI reference (a CLI map), generated from the command tree (loom docs v0.1.0)

USAGE `loom docs [OPTIONS] `

OPTIONS

  `--out`    Write the Markdown reference to this file instead of stdout
```

## `loom eval`

Run a component's evals against the real harnesses (reports UNTESTED honestly)

```
Run a component's evals against the real harnesses (reports UNTESTED honestly) (loom eval v0.1.0)

USAGE `loom eval [OPTIONS] [DIR]`

ARGUMENTS

  `DIR="."`    Plugin directory    

OPTIONS

  `--component`    Only eval this component leaf name           
    `--harness`    Restrict to these harnesses (comma-separated)
```

## `loom import`

Reverse-compile an existing native plugin/marketplace into a Loom plugin

```
Reverse-compile an existing native plugin/marketplace into a Loom plugin (loom import v0.1.0)

USAGE `loom import [OPTIONS] [DIR]`

ARGUMENTS

  `DIR="."`    Dir with an existing native plugin or marketplace    

OPTIONS

   `--from="claude"`    Source harness format                                 
  `--out="imported"`    Output directory                                      
       `--namespace`    Reverse-DNS namespace to assign (default com.imported)
```

## `loom index`

Build a metadata index from plugin dirs (optionally federating the MCP Registry)

```
Build a metadata index from plugin dirs (optionally federating the MCP Registry) (loom index v0.1.0)

USAGE `loom index [OPTIONS] [DIR]`

ARGUMENTS

  `DIR="."`    Plugin directories    

OPTIONS

  `--out="index.json"`    Output index file                          
          `--federate`    Ingest the MCP Registry (GET /v0.1/servers)
```

## `loom init`

Scaffold a new plugin (loom.yaml + a sample skill)

```
Scaffold a new plugin (loom.yaml + a sample skill) (loom init v0.1.0)

USAGE `loom init [OPTIONS] [DIR]`

ARGUMENTS

  `DIR="."`    Target directory    

OPTIONS

       `--name`    Plugin name (kebab-case)            
  `--namespace`    Reverse-DNS namespace, e.g. com.acme
```

## `loom install`

Compile + place a plugin into a harness scope, write loom.lock

```
Compile + place a plugin into a harness scope, write loom.lock (loom install v0.1.0)

USAGE `loom install [OPTIONS] [DIR]`

ARGUMENTS

  `DIR="."`    Plugin directory    

OPTIONS

  `--scope="project"`    user | project                                                       
           `--target`    Comma-separated targets (default: all registered)                    
             `--only`    Comma-separated component names to install piecemeal (e.g. one skill)
              `--all`    Install to requested targets even if the harness is not detected     
          `--managed`    Managed mode: only allow these namespaces (comma-separated allowlist)
              `--cwd`    Project root for project-scope placement (default: cwd)
```

## `loom publish`

Run the deterministic publish gate (static valid + trace/output evals)

```
Run the deterministic publish gate (static valid + trace/output evals) (loom publish v0.1.0)

USAGE `loom publish [OPTIONS] [DIR]`

ARGUMENTS

  `DIR="."`    Plugin directory    

OPTIONS

  `--snapshot`    Snapshot eval scores into evals/.baselines/ for the next release
```

## `loom sign`

Sign loom.lock's artifact set (ed25519) -> loom.sig + loom.pub (the signed badge)

```
Sign loom.lock's artifact set (ed25519) -> loom.sig + loom.pub (the signed badge) (loom sign v0.1.0)

USAGE `loom sign [OPTIONS] [DIR]`

ARGUMENTS

  `DIR="."`    Plugin dir with loom.lock
```

## `loom uninstall`

Remove everything install placed (from loom.lock) and delete the lockfile

```
Remove everything install placed (from loom.lock) and delete the lockfile (loom uninstall v0.1.0)

USAGE `loom uninstall [OPTIONS] [DIR]`

ARGUMENTS

  `DIR="."`    Plugin dir with loom.lock
```

## `loom update`

Re-resolve refs, recompile, and re-place only artifacts whose hash changed

```
Re-resolve refs, recompile, and re-place only artifacts whose hash changed (loom update v0.1.0)

USAGE `loom update [OPTIONS] [DIR]`

ARGUMENTS

  `DIR="."`    Plugin directory    

OPTIONS

  `--scope="project"`    user | project                                         
           `--target`    Comma-separated targets (default: all registered)      
              `--cwd`    Project root for project-scope placement (default: cwd)
```

## `loom validate`

Statically validate a plugin (the valid badge)

```
Statically validate a plugin (the valid badge) (loom validate v0.1.0)

USAGE `loom validate [OPTIONS] [DIR]`

ARGUMENTS

  `DIR="."`    Plugin directory
```

## `loom verify`

Verify loom.sig against loom.lock and the on-disk artifacts

```
Verify loom.sig against loom.lock and the on-disk artifacts (loom verify v0.1.0)

USAGE `loom verify [OPTIONS] [DIR]`

ARGUMENTS

  `DIR="."`    Plugin dir with loom.lock
```

