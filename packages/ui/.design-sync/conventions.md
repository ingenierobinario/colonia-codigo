# Colonia design system (@colonia/ui) — how to build with it

## 1. Always wrap in `ColoniaProvider`
Every component reads `--colonia-*` CSS variables that only exist under a provider. Without it, colors, radii and fonts fall back to browser defaults.

```tsx
const { ColoniaProvider, Composer } = window.ColoniaUI;
<ColoniaProvider look="minimal" mode="light" fill>{/* screen */}</ColoniaProvider>
```

- `look="minimal"` (default, Colonia v2): warm greys, **ink** primary (near-black), pill controls, borderless bubbles.
- `look="classic"` (Colonia v1): **Colonia green** primary/selection, bordered groups, mono metadata, UPPERCASE role tags, 8–12px radii. Classic is normally used with `mode="dark"`.
- `mode="light" | "dark"` for either look. `fill` paints `--colonia-bg` and fills the parent height (use it on the root).
- Nest a second `ColoniaProvider` to render a region in another look/mode. Menus, tooltips and dialogs portal into the nearest provider, so they keep its look.
- The look is a token swap, never different markup. Don't restyle components per look by hand.

## 2. Styling idiom: tokens, not classes
Components are styled; you only write layout glue (flex/grid, gaps, widths) with inline styles or your own CSS, using tokens:
- Surfaces: `--colonia-bg` (page), `--colonia-sidebar`, `--colonia-surface` (panels), `--colonia-surface-raised`, `--colonia-fill` / `--colonia-fill-hover` / `--colonia-fill-strong` (soft fills), `--colonia-popup-hover` (a hovered row in a menu or popup; set only in dark, falls back to `--colonia-fill`), `--colonia-border`, `--colonia-border-strong`.
- Text: `--colonia-fg`, `--colonia-fg-muted`, `--colonia-fg-subtle`.
- Accent: `--colonia-accent` / `--colonia-accent-fg` (primary action), `--colonia-brand` (Colonia green, both looks), `--colonia-selection`.
- Tones: `--colonia-{brand|violet|info|warning|danger}` plus `-soft` and `-soft-fg` variants.
- Shape and type: `--colonia-radius-{sm|md|lg|xl|pill}`, `--colonia-space-{1..8}` (4px steps), `--colonia-text-{2xs|xs|sm|md|lg|xl|2xl}`, `--colonia-font-sans`, `--colonia-font-mono`, `--colonia-shadow-{sm|md}`.

Never hard-code hex colors. Never use `colonia-*` class names from the stylesheet directly; use the components.

## 3. Where the truth lives
- `styles.css`, which imports the component stylesheet (tokens for all 4 look×mode combos are at its top).
- Each component's `.prompt.md` (purpose, when to use it and when not, look differences, example) and `.d.ts` (props).

## 4. Composition rules (Colonia product language)
- Agents are always shown with `AgentAvatar` (Colonia blobs, `blob="noche" | "menta" | "amatista" | …`, see `BLOB_NAMES`). People and projects use `Avatar`.
- Chat thread: `Message` (agent left, user right) · tool calls folded in `ActionGroup` · events in `SystemNote` with `AgentChip` · run reports as `StepList` inside a Message · drafts/tasks/routines as `EntityCard` inside `<Message variant="bare">` · live agent-to-agent work as `ActivityPill` · `Composer` at the bottom (pill on mobile/minimal, `toolbar` box on desktop/classic).
- Sidebar: `SearchField` → `NavItem`s (Home, Inbox, In progress) → `SectionLabel` + project `NavItem`s → `ConversationRow`s.
- One `Button variant="primary"` per view/card; secondary next to it. Icon-only actions use `IconButton` with a `label`.
- Icons: `Icons.<Name>` (curated lucide set), 14–18px.
- Calm by default: few borders, generous spacing, no decorative animation (blobs are the exception).

## 5. Example
```tsx
const { ColoniaProvider, Message, StepList, ActionGroup, SystemNote, AgentChip, Composer, Icons } = window.ColoniaUI;
<ColoniaProvider look="minimal" mode="light" fill>
  <div style={{ display: "flex", flexDirection: "column", height: "100%", maxWidth: 720, margin: "0 auto", padding: "var(--colonia-space-4)" }}>
    <div style={{ flex: 1, overflow: "auto" }}>
      <Message><StepList steps={[{ label: "CRM", detail: "list pulled · 52 accounts" }, { label: "Sequencer", detail: "36 drafts queued", status: "running" }]} /></Message>
      <ActionGroup title="Actions 1–10 of 16" failed={2} items={[{ name: "crm.query", detail: "accounts where tier = A", aside: "0.8s" }]} />
      <SystemNote icon={<Icons.Clock size={14} />}>Updated memory for <AgentChip name="Ledger" blob="amatista" /></SystemNote>
      <Message from="user">The top 10 look good. Send it.</Message>
    </div>
    <Composer placeholder="Message Outbound" onAttach={() => {}} />
  </div>
</ColoniaProvider>
```
