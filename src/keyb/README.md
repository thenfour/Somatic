# Keyboard Shortcuts System (Developer README)

This module implements a **single-source-of-truth** keyboard shortcut system. It is designed to keep keyboard shortcuts in a managable place, reduce boilerplate for callers, and help enable user-configurable shortcuts.

- Actions = semantic commands ("play", with descriptions)
- Chords = a keyboard shortcut def ("Ctrl+V")
- Bindings = ties actions to chords
- Resolver = focus + platform; where is a binding invokable in code
- Dispatcher = connects bindings to resolver


## tryies to improve on

- Shortcut logic scattered across components in `keydown` handlers
- Documentation: tooltips, menus, help screen, and handlers diverge.
- Allow user-configurable shortcuts without adding tons of boilerplate and logic to call sites
- Handle vexing scenarios like focus handling, typing in `<input>` boxes
- handling platform differences (Cmd vs Ctrl)
- Physical key handling (`event.code`) vs. character key (`event.key`)

## Concepts

### Actions

a semantic operation: `"play"`, `"pattern.smallMoveLeft"`.

Actions live in a central `ActionRegistry` and include:
- `title`, `description`, `category` — for help/UI generation
- `defaultBindings` — per platform (mac/win/linux)
- policies:
  - `allowInEditable` (default false)
  - `allowRepeat` (default false)
  - `preventDefault` / `stopPropagation` (defaults true when handled)
  - `when(ctx)` predicate for enable/disable

### Bindings

A **binding** maps an `ActionDef` to one or more `ShortcutChord`s.

There are two chord types:

#### Character chord (`kind: "character"`)

uses `event.key` (layout-aware). Use for most app commands (Cmd/Ctrl+something), because users expect shortcuts to follow their keyboard layout.

Example:
```ts
{ kind: "character", key: "k", primary: true }
````

#### Physical chord (`kind: "physical"`)

Matches `event.code` (layout-agnostic geometry).

Use for "computer keyboard behaves like an instrument". This makes the physical grid stable even on AZERTY/DVORAK.

Example:

```ts
{ kind: "physical", code: "KeyA" }
```

### Editable targets (input text boxes)

By default, shortcuts do **not** fire when the event target is:

* `<input type="text|search|...">`
* `<textarea>`
* `<select>`
* `contenteditable`

unless the action explicitly sets:

```ts
allowInEditable: true
```

## Quirks

### Reserved / OS/browser collisions

Stuff like <kbd>F5</kbd> should not be used. We treat these kinds of reserved chords as a warning but still allow it because there's no way to know for sure. Just make a guess.

### chars requiring shift and strictness

Our matching strategy is strict: if you specify `shift=true`, it requires shift to be down. If you specify `shift=false`, then it **must not** be down.
And not specifying a modifier means it must not be down. This is so you don't have to specify all modifiers for all keys.

Charecters like `?` or `{` therefore cause issues. Most keyboard layouts require <kbd>shift</kbd> to type these.
So if you want to use `?` as a shortcut chord, you **probably** need to specify `shift=true`. But then if you use
a different keyboard layout that doesn't require <kbd>shift</kbd> to type `?`, then it won't resolve.

For user-configured bindings it's OK because we'll capture whatever your keyboard does; it follows you.

But the problem is our specified default bindings. If we want `?` to be a default keyboard shortcut, we need to decide whether
or not to specify `shift=true`.

maybe there's a fancy way of dealing with this gracefully, but ... it's ok for now.


## Examples

### Define an action registry

```ts
export const actions: ActionRegistry = {
  "app.help": {
    id: "app.help",
    title: "Show help",
    description: "Open the keyboard shortcuts help screen.",
    category: "App",
    defaultBindings: {
      mac: [{ kind: "character", key: "?", shift: true }],
      win: [{ kind: "character", key: "?", shift: true }],
      linux: [{ kind: "character", key: "?", shift: true }],
    },
  },

  "transport.playPause": {
    id: "transport.playPause",
    title: "Play/Pause",
    category: "Transport",
    defaultBindings: {
      mac: [{ kind: "character", key: "Space" }],
      win: [{ kind: "character", key: "Space" }],
      linux: [{ kind: "character", key: "Space" }],
    },
    allowInEditable: false,
  },

  "piano.noteC": {
    id: "piano.noteC",
    title: "Piano: C",
    category: "Piano",
    defaultBindings: {
      mac: [{ kind: "physical", code: "KeyA" }],
      win: [{ kind: "physical", code: "KeyA" }],
      linux: [{ kind: "physical", code: "KeyA" }],
    },
    allowRepeat: true,
    allowInEditable: true, // if you want it to work even when an input is focused in piano mode
  },
};
```

### Install the manager at the app root

```tsx
export function App() {
  return (
    <ShortcutManagerProvider actions={actions}>
      {/* ...the rest of your app... */}
    </ShortcutManagerProvider>
  );
}
```

### Register action handlers via a hook

```tsx
useActionHandler("transport.play", () => {
// toggle playback
});
```

### Capture a new binding in settings UI

```tsx
export function BindingsEditorRow({ actionId }: { actionId: string }) {
  const mgr = useShortcutManager();
  const capture = useChordCapture({ kind: "character", platform: mgr.platform });

  React.useEffect(() => {
    if (!capture.capturing) return;

    const onAnyKey = (e: KeyboardEvent) => {
      const chord = capture.captureFromEvent(e);
      if (!chord) return;

      mgr.setUserBindings(prev => ({
        ...prev,
        [actionId]: [chord],
      }));

      capture.setCapturing(false);
    };

    document.addEventListener("keydown", onAnyKey, true);
    return () => document.removeEventListener("keydown", onAnyKey, true);
  }, [capture, mgr, actionId]);

  return (
    <button onClick={() => capture.setCapturing(true)}>
      Rebind...
    </button>
  );
}
```


## TODO

- **Chord sequences** , e.g. `p x`, `Ctrl+K Ctrl+C` (vs code style)
- **Keyup support**; current module is keydown-only; for piano we could use keyup for note-off
