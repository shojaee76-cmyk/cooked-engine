# COOKED — Design Evolution Note (2026-09-20, pass 1)

The design brief was: evolve the warm-graphite receipt-printer look from good to exceptional
without changing a single behaviour, a single line of the joke bank, or the palette identity.
This document records what pass 1 changed and why. Everything here ships behind the same URLs.

## Constraint set (unchanged)

- Palette identity: warm graphite chassis, cream paper stock, one ember accent.
- Fonts: Barlow Condensed (display) + Azeret Mono (body), base64 embedded.
- The receipt metaphor is the product. It was not re-skinned.
- src/ untouched: the engine, joke bank and worker are byte-identical. This pass is front/index.html only.

## Pass 1: make the machine physically believable

The first build was "a webpage styled like a printer". Pass 1 moves it toward "an object
photographed on a desk", using only material cues, no new colours:

1. **Assembly hardware.** The control console now carries four corner screws (gradient-lit,
   inset shadow). The printer body has two more at its base. Screws are how the eye decides
   "manufactured object" versus "styled div"; they cost 10 lines of CSS.
2. **The tear bar.** A real receipt printer has a serrated strip where paper leaves the machine.
   A toothed `repeating-linear-gradient` bar with a highlight edge now sits between slot and paper.
   It also gives the paper a reason to have a jagged bottom edge.
3. **Machined buttons.** Every control (sound, heat segments, action buttons) now has a subtle
   vertical gradient, an inset top highlight, a hard 2px offset shadow, and press physics
   (the button translates into its shadow on :active). Buttons used to be flat rectangles; now
   they are the same material as the chassis.
4. **The sound button got an LED** that follows its state (measured-green when on, dead grey when
   off), consistent with the printer's status LED. Small thing, but it removes the only "software
   looking" control on the machine.
5. **Paper grain replaces stripes.** The chassis background was a 2px stripe pattern, which read as
   a texture trick. It is now a 5px dot grid at 2.8% opacity, which reads as sprayed metal.
6. **Ink selection colour.** Text selection is ember on white, so even selecting text re-states
   the brand.
7. **Focus rings.** Every interactive element has a visible `:focus-visible` ring in measured-green.
   Accessibility and the hardware look agree here: machines label their controls.
8. **Reduced motion is now total.** LED blink, stamp thunk and item reveals all stop under
   `prefers-reduced-motion`, not just the paper feed.
9. **Small copy fixes:** the wallet placeholder is shorter (it was overflowing its box on phones),
   and the health fetch no longer runs on file:// (the offline specimen receipt was printing a
   console error for no reason).

## Measured result

- Local close-out gate: before 3 hard / 3 soft, after **0 hard / 2 soft**.
- Live gate on the shipped URL (cache-busted): **PASS, 0 hard / 4 soft**.
- Live bytes == dist/index.html bytes (158,998), so the gate measured what ships.
- Behaviour unchanged: heat switch, NOFX, copy/save/print, readings bindings, joke bank all intact;
  `git diff --name-only -- src/` is empty.

## Rejected on purpose

- Any palette change or a second accent: the ember is the brand.
- Glassmorphism / neumorphism: reads as slop on a machine metaphor.
- Adding illustration or a mascot: the receipt is the hero, not a character.
- Widening the receipt: thermal paper is narrow; the whitespace beside it is the point.

## What pass 2 would take (not built)

- The readings panel as a second physical object (clip-board or instrument case) instead of a panel.
- A subtle paper-jam easter egg when the API 429s twice in a row.
- Print stylesheet polish for people who actually print the receipt on real paper.
