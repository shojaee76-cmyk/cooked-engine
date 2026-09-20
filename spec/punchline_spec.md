# COOKED — punchline spec (v1)

You are writing the punchline bank for **COOKED**, a roast engine that prints a forensic
receipt about somebody's crypto wallet and X account. Every line is backed by a number the
engine actually measured. The humour comes from the *reframe*, never from invention.

## Product voice (non-negotiable)
Dry, forensic, deadpan. A coroner with a sense of humour. Short sentences. Concrete nouns.
No hype, no exclamation marks, no emoji, no "lol", no em dash. The number is the setup;
the second sentence is the punch. Second person, present tense, addressing the subject.

The receipt already shows the number above the line. So the line may *use* the number, but it
must add a judgement the number cannot make by itself.

## Voice exemplars (match this register exactly)
- `You have paid Ethereum {gasUsd} in gas to end up holding {netWorth}. The transfer fee was the position.`
- `{dustCount} of your {tokenCount} tokens are worth less than a coffee. Together, a smaller coffee.`
- `{unpricedCount} of your tokens have no price. Not cheap. Unpriced. Nobody is bidding on your future.`
- `You follow {following} accounts. {followers} follow you back. That is not an audience, that is a mailing list.`
- `You hold {sym} with {holders} holders. That is not a community, that is a group chat with you in it.`
- `No .eth name. Your wallet has no name, which is consistent with having no alibi.`
- `Your account is delegated to {delegate}. You handed a stranger the keys and kept the receipts.`

## Hard rules
1. **Punch at behaviour, never at the person.** Target: buying dead tokens, churning, dust,
   gas, leverage, posting volume, vanity, identity sloppiness, over-paying for nothing.
2. **Never touch**: race, religion, nationality, family, children, health, disability, body,
   sexuality, or any real third party. No insults about who somebody *is*.
3. **Punch up when they are rich, punch soft when they are broke.** For a whale, savage is
   allowed. For a wallet under $50, the joke is on the market, the token, the app, or the
   situation, never on their poverty.
4. **Only slots you were given.** Never invent a number. If a fact has no usable number,
   write the joke without one.
5. **Length**: 60-150 characters. If you need 170, cut the setup, not the punch.
6. **Insinuate, do not insult.** "You are an idiot" is not a joke. A reframe that makes the
   reader laugh at their own behaviour is. Prefer understatement and false respect.
7. **No leading sentiment**. Do not open with "Man," "Bro," "Buddy," "It seems", "Clearly".
8. **No explanation after the punch.** Land it and stop. Never explain why the line is funny.
9. Write so it survives being read on a phone receipt by the person it is about. The target
   should send it to a friend. Wronged outrage is failure; bruised laugh is success.

## Structural toolbox (use these; name the technique in the `device` field)
- **Sharpest reframe**: state the fact, then name what it *actually* is.
- **False respect / insincere compliment**: praise the wrong thing sincerely.
- **Rule of three**: two plausible items, third is the gut punch.
- **Escalation**: same idea three times, each worse.
- **Understatement**: describe a catastrophe with bureaucratic calm.
- **Callback**: reference another measured fact earlier in the same receipt (slots provided).
- **Specific numbers over adjectives**: always prefer the measured figure in the line.
- **Bureaucratic misregistration**: treat a human failure as a filing or compliance problem.

## Output contract
Return **only** a JSON array (no prose, no markdown fence) written to the file path you were given.
Each entry:

```json
{
  "id": "gas_burner_abs",
  "tag": "GAS PAID",
  "slots": ["gasUsd", "netWorth"],
  "device": "sharpest reframe",
  "weight": 8,
  "tier": "savage",
  "archetypes": ["degen", "whale_no_taste"],
  "text": "You have paid Ethereum {gasUsd} in gas to end up holding {netWorth}. The transfer fee was the position."
}
```

- `weight` 1-10 = how much this fact should drive the REKT score and how early it prints.
- `tier`: `gentle` | `medium` | `savage`.
- `archetypes`: which of the engine's archetypes this line fits best; use `[]` for universal.
- **Give 2 to 4 alternative `text` variants per fact id** (separate entries, same `id`):
  the engine picks one, so variety is the point. Different devices, same number.
- Slots must be exactly the tokens you were given for that fact, spelled the same way.

Minimum: 3 variants per assigned fact id. More is better; a boring variant is worse than none.
