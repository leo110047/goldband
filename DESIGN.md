# goldband Design Guidance

Design source of truth for UI, frontend, visual, and presentation work in this
repo. It does not apply to backend, infrastructure, or non-visual work. An
existing product design system takes precedence; this file applies where none
exists.

## Design Intent

The interface is tool-like, deliberate, and high-signal: one clear point of
view, executed with discipline, distinct from internal admin panels and
template SaaS layouts.

## Baseline Stance

Without a product-specific system:

- Editorial and utilitarian composition, not dashboard chrome.
- Hierarchy and composition are decided before components.
- A restrained palette with one assertive accent.
- A distinctive display face paired with a quieter body face.
- Motion only where it carries meaning.
- Light or dark mode chosen for the product context.

## Required Decisions Before Coding

- Typography: display face, body face, and the reason for each.
- Color: base palette, accent, and excluded colors.
- Spacing: the density model.
- Layout: the first-viewport anchor and the main visual rhythm.
- Motion: where movement carries meaning and where it is absent.

Components are not generated until these are decided.

## Low-Originality Signals

These require justification from the existing product, the product context, or
deliberate execution:

- Gray card grids as the default layout.
- System-font or Inter-first styling without typographic hierarchy.
- Trend styling in place of hierarchy or a point of view.
- Uniform pills, chips, and badges without hierarchy.
- Decoration that serves no hierarchy, identity, or comprehension purpose.
- Pages without a focal point.
- Animation without a choreographed purpose.

## Typography

- Display text, navigation, body text, metadata, and code or data have visibly
  distinct roles.
- Common fonts are allowed when they still produce hierarchy and identity.

## Color

- Each color has one role: background, foreground, surface, accent, or muted
  support.
- One accent, used with confidence.
- Dark mode builds depth from layered tones, not near-black boxes on black.

## Layout and Composition

- Composition precedes components; cards are used only where they improve
  clarity, grouping, or rhythm.
- Every screen has a visual anchor in the first viewport.
- Dense interfaces are structured, not cramped.
- Repeated components create rhythm.
- Buttons, chips, tags, and panels differ in radius, weight, and contrast
  according to their role.

## Motion

- Few motion beats, each with a purpose.
- Reduced-motion preferences are respected and motion degrades cleanly.

## Accessibility and Responsiveness

- Contrast, keyboard access, visible focus, and readable type scales are
  preserved.
- Mobile layouts are designed for the viewport, not stacked desktop layouts.

## Review Standard

UI work is complete when:

- The screen has a coherent goldband mood.
- Visual decisions are product-specific, not template defaults.
- Typography, spacing, color, states, and responsive behavior hold up.
- The user can understand the screen, find the primary action, and complete
  the task.
- Applicable browser, screenshot, responsive, or interaction checks ran; the
  rest is reported as unverified.
