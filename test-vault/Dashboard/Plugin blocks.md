---
ready: false
---
Blocks from community plugins, to check that they work inside a patchwork in Use mode. They need Dataview, Tasks, Buttons and Meta Bind installed, and the Bases core plugin on.

## Dataview

```dataview
TASK FROM "Dashboard/Session"
```

```dataview
LIST FROM "Spells"
```

## Tasks

```tasks
path includes Dashboard/Session
not done
```

## Buttons

```button
name Toggle left sidebar
type command
action Toggle left sidebar
```

## Meta Bind

Ready: `INPUT[toggle:ready]`

```meta-bind-button
label: Toggle right sidebar
style: primary
actions:
  - type: command
    command: app:toggle-right-sidebar
```

## Bases

```base
views:
  - type: table
    name: Spells
    filters:
      and:
        - file.inFolder("Spells")
```
