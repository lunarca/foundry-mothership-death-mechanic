# Mothership Sealed Death Save

A Foundry VTT module for the [MoSh (Mothership 1e)](https://github.com/Futil/foundry-mothership) system. When a character's Wounds reach their maximum, it rolls the Death Save and seals it right away, before anyone (GM included) sees the result. The result stays hidden until someone at the table checks on the character. Then it's revealed on every screen at once.

The roll is fixed the moment the character goes down. Checking on them only finds out what already happened.

## How it plays

1. **A character hits max Wounds.** This works however the Wounds change: the system's damage rolls, another module's damage helper, or a hand edit on the sheet. The active GM's client rolls the system's 1e *Death Save* table in memory. Nothing goes to chat, no dice are shown, and the result is stored obscured on the actor.
2. **Everyone sees the sealed window.** Every connected player and the GM get a pop-up with the character's portrait, a redacted result and a seal code such as `SEAL 463E-D722`. A chat card records the seal too. Players who join later see the window when they connect.
3. **Someone checks on them.** Anyone can press **Check on them**, in the window or with a macro. With **GM verify before reveal** on, a player's press becomes a request the GM approves or denies.
4. **The reveal.** The window un-blurs on every screen, Dice So Nice rolls the stored dice if it's installed, and a public chat card shows the result. It also confirms the seal code still matches, which proves the result wasn't changed after sealing.

A GM can discard a sealed save without revealing it with the trash button in the window, for example after a mistaken Wound.

## Settings

| Setting | Scope | Default | What it does |
| --- | --- | --- | --- |
| Seal automatically at max Wounds | World | On | Turn off to seal only by macro. |
| GM verify before reveal | World | Off | A player's reveal becomes a request the GM must approve. |
| Roll Dice So Nice dice on reveal | Per user | On | Shows the stored roll when it's revealed. |

## Macros

```js
const api = game.modules.get("mothership-death-mechanic").api;

api.seal();     // roll and seal for the selected token (or your character)
api.reveal();   // check on them
api.open();     // reopen the window
api.discard();  // GM: throw the seal away unrevealed
```

Each call also takes an actor or actor UUID, for example `api.reveal(game.actors.getName("Ripley"))`.

## How hidden is hidden?

No screen shows the result before the reveal, but this isn't cryptographic secrecy. Foundry gives the GM's browser all world data, so a GM who goes digging in the developer console could decode it. The seal code (a SHA-256 fingerprint of the result) makes tampering visible at the reveal.

## Requirements

- Foundry VTT 13 or 14
- MoSh system 0.6.0 or newer, using its 1e Death Save table (the `table1eDeath` setting, so a custom table works too)
- A GM connected, since sealing and revealing run on the GM's client

## Installing

Install from the manifest URL:

```
https://github.com/lunarca/foundry-mothership-death-mechanic/releases/latest/download/module.json
```

Publishing a GitHub release builds `module.zip` and a versioned `module.json` and attaches them to the release.
