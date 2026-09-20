# COOKED — BRUTAL tier spec (the register that was missing)

The first bank was written as a coroner's report: accurate, dry, and too polite. It reads like a
sympathetic analyst. This tier is the actual roast. Same numbers, same guardrails, no sympathy.

## What changed in the voice

| Soft tier (what we shipped first) | Brutal tier (what this spec is for) |
|---|---|
| "That is not a community, that is a group chat with you in it." | "You are not early. You are the last one in a room nobody else enters." |
| "The transfer fee was the position." | "The network made more money from you than you have ever made from it." |
| "You are the audience, not the show." | "You are not a creator. You are a subscriber with a wallet and an opinion." |
| Observation about the data | Verdict on the person who chose it |

The subject is a fool and the receipt is the evidence. Write the second sentence as a judgement, not a
description. If a line could appear in a neutral analytics report, it is not done.

## Rules that still hold (these are not negotiable)

1. **Attack behaviour, decisions and self-image. Never identity.** No slurs, no body, no family, no
   faith, no health, no gender, no nationality. Same filter as before, now enforced at build time.
2. **Numbers first.** Every line must sit on a measured figure. Contempt without arithmetic is just noise.
3. **For a wallet under $50, hit the gap between the posting and the balance, never the poverty itself.**
   "You post like a whale and hold $40" is devastating and true. "You are poor" is neither.
4. **Nothing fabricated.** No invented crimes, no accusations of fraud, no claims the data cannot back.
5. **No financial advice, no price predictions, no implication anyone stole from them.**
6. **150 characters max, punch in the last clause, no em dash.**
7. **The target must be able to laugh once.** The bar: he sends the receipt to his group chat. If the
   only possible reaction is fury, the line is a failure of craft, not a flex.

## Devices to use hard

- **Contempt** ("You did not lose. You were the market's easiest customer.")
- **Humiliation by accuracy** (state the number, then name what it makes him)
- **The kill shot**: one sentence that ends on the worst word
- **False respect, then the turn** ("Masters of positioning like yourself who hold {unpricedCount} tokens nobody will price")
- **The nobody line** ("Nobody is waiting for your next post. {postsPerDay} a day and still nobody.")
- **The legacy line** ("After {years} years this is what you built.")
- **Escalation** (three clauses, each worse than the last)
- **The receipt-as-verdict** ("This is not a portfolio. It is a list of people who took your money.")

## Voice exemplars (match this exactly)

1. `You have paid {gasUsd} in fees to hold {netWorth}. The network earned more from you than you ever earned from it.`
2. `{dustCount} tokens worth under a dollar. You call it a portfolio. It is a landfill and you are the only visitor.`
3. `You follow {following} accounts and {followers} follow you back. You are not a creator, you are a subscription.`
4. `{postsPerDay} posts a day for {years} years. {tweets} times you mistook speaking for mattering.`
5. `No .eth name. Nobody wanted it and you did not either.`
6. `{sym} has {holders} holders including you. You are not early, you are the last one in a room nobody enters.`
7. `Your biggest position is {topUsd} of {topSym}. You are not an investor, you are exit liquidity with a receipt.`
8. `{unpricedCount} tokens nobody will ever buy. That is not a long term hold, that is a refusal to admit the mistake.`
9. `{txCount} transactions and {netWorth}. You have been busy for years and arrived nowhere. Nobody noticed.`
10. `{netWorth} across {chainsActive} chains. You are not diversifying, you are hiding from one decision.`

## Output contract

Same JSON array as `spec/punchline_spec.md`, written to the file path you are given, with:

- `"tier": "brutal"`
- the same `id` values as the fact ids you are assigned (they must match exactly, so the engine can
  swap a soft line for a brutal one on the same fact)
- 3 to 4 variants per fact id, each a different device
- `"weight"` 6-10 for the facts that should dominate a receipt
- `"archetypes"` left `[]` unless a variant is clearly better for one archetype

Write at least 3 variants per assigned id. Boring variants are worse than none: if you cannot make a
fact hurt, leave it out rather than padding it.
