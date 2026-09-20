/* ============================================================================
   COOKED — the joke bank. Injected at build time from punchlines/*.json.
   Shape: { byId: { fact_id: [ {text, slots, device, weight, tier, archetypes} ] },
            tags: { fact_id: label }, verdicts: [ "closing line", ... ],
            archetypeDesc: { archetype_id: "one line definition" } }
   Every line was written to the spec in spec/punchline_spec.md: number in the
   setup, reframe in the punch, behaviour never identity, no invented facts.
   ========================================================================== */

const PUNCHLINES = /*__BANK__*/{};
