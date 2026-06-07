# Loom CLI reference

_Generated from the CLI definition by `loom docs` -- do not edit by hand._

## `loom`

```
Author once, compile to every coding-agent harness. (loom v0.1.0)

USAGE `loom init|validate|build|install|docs`

COMMANDS

      `init`    Scaffold a new plugin (loom.yaml + a sample skill)                       
  `validate`    Statically validate a plugin (the valid badge)                           
     `build`    Compile a plugin (or a marketplace of plugins) to harness manifests      
   `install`    Compile + place a plugin into a harness scope, write loom.lock           
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

