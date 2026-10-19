import { FLAG, MODULE_ID, SETTINGS, SOCKET, localize } from "./constants.js";
import { obscure, sealCode, unobscure } from "./seal-codec.js";

/** Actors whose seal is being written right now, so two quick updates can't roll twice. */
const sealing = new Set();

/** Actors with a GM verify prompt already open, so repeated clicks don't stack dialogs. */
const verifying = new Set();

export function getSeal(actor) {
  return actor?.getFlag(MODULE_ID, FLAG) ?? null;
}

export function hasPendingSeal(actor) {
  const seal = getSeal(actor);
  return Boolean(seal && !seal.revealed);
}

export function hasReachedMaxWounds(actor) {
  const hits = actor?.system?.hits;
  if (actor?.type !== "character" || !hits) return false;
  const max = Number(hits.max);
  return max > 0 && Number(hits.value) >= max;
}

/** Resolves an actor from an argument, the selected token, or the user's character. */
export function resolveActor(actor) {
  if (typeof actor === "string") actor = fromUuidSync(actor) ?? game.actors.get(actor);
  return actor ?? canvas.tokens?.controlled[0]?.actor ?? game.user.character ?? null;
}

/** The MoSh system stores its 1e Death Save table id (or uuid) in a world setting. */
async function findDeathTable() {
  const ref = game.settings.get("mosh", "table1eDeath");
  if (!ref) return null;
  if (ref.includes(".")) {
    const table = await fromUuid(ref);
    if (table) return table;
  }
  const worldTable = game.tables.get(ref);
  if (worldTable) return worldTable;
  for (const pack of game.packs) {
    if (pack.documentName === "RollTable" && pack.index.has(ref)) return pack.getDocument(ref);
  }
  return null;
}

/** Rolls the table in memory only: no chat message, no dice animation, nothing on screen. */
async function rollHidden() {
  const table = await findDeathTable();
  if (!table) throw new Error(localize("Error.NoTable"));
  const { roll, results } = await table.roll();
  return {
    tableName: table.name,
    tableUuid: table.uuid,
    formula: roll.formula,
    total: roll.total,
    roll: roll.toJSON(),
    results: results.map(r => ({ name: r.name ?? "", description: r.description || r.text || "" }))
  };
}

/** GM only. Rolls and seals a Death Save unless one is already waiting to be revealed. */
export async function sealDeathSave(actor) {
  if (!game.user.isGM || !actor) return null;
  if (hasPendingSeal(actor) || sealing.has(actor.id)) return getSeal(actor);
  sealing.add(actor.id);
  try {
    const result = await rollHidden();
    const plaintext = JSON.stringify(result);
    const nonce = foundry.utils.randomID(16);
    const seal = {
      nonce,
      payload: obscure(plaintext, nonce),
      code: sealCode(nonce, plaintext),
      sealedAt: Date.now(),
      revealed: false
    };
    // Replace rather than merge, so nothing from an earlier, revealed seal survives.
    if (getSeal(actor)) await actor.unsetFlag(MODULE_ID, FLAG);
    await actor.setFlag(MODULE_ID, FLAG, seal);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: sealedCardHtml(actor),
      flags: { [MODULE_ID]: { actorUuid: actor.uuid } }
    });
    return seal;
  } catch (err) {
    console.error(`${MODULE_ID} | Could not seal the Death Save`, err);
    ui.notifications.error(err.message);
    return null;
  } finally {
    sealing.delete(actor.id);
  }
}

/** GM only. Opens the seal, checks it against its code, and shows it to everyone. */
export async function revealDeathSave(actor, requestedBy = game.user.id) {
  if (!game.user.isGM || !hasPendingSeal(actor)) return;
  const seal = getSeal(actor);
  const plaintext = unobscure(seal.payload, seal.nonce);
  const verified = sealCode(seal.nonce, plaintext) === seal.code;
  const result = JSON.parse(plaintext);
  if (!verified) console.warn(`${MODULE_ID} | ${actor.name}'s Death Save no longer matches its seal code`);
  await actor.setFlag(MODULE_ID, FLAG, {
    revealed: true,
    verified,
    result,
    revealedAt: Date.now(),
    revealedBy: requestedBy
  });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: revealedCardHtml(actor, result),
    flags: { [MODULE_ID]: { actorUuid: actor.uuid } }
  });
}

/** GM only. Throws a seal away, for example after a mistaken trigger. */
export async function discardSeal(actor) {
  if (!game.user.isGM || !getSeal(actor)) return;
  await actor.unsetFlag(MODULE_ID, FLAG);
}

/** Anyone. Seals directly as GM, otherwise asks the active GM's client to. */
export function requestSeal(actor) {
  actor = resolveActor(actor);
  if (!actor) return ui.notifications.warn(localize("Notify.NoActor"));
  if (game.user.isGM) return sealDeathSave(actor);
  if (!game.users.activeGM) return ui.notifications.warn(localize("Notify.NeedGM"));
  game.socket.emit(SOCKET, { type: "requestSeal", actorUuid: actor.uuid, userId: game.user.id });
}

/** Anyone. A GM reveals at once; a player's request goes to the GM, who may have to approve it. */
export function requestReveal(actor) {
  actor = resolveActor(actor);
  if (!actor) return ui.notifications.warn(localize("Notify.NoActor"));
  if (!hasPendingSeal(actor)) return ui.notifications.warn(localize("Notify.NothingSealed", { name: actor.name }));
  if (game.user.isGM) return revealDeathSave(actor);
  if (!game.users.activeGM) return ui.notifications.warn(localize("Notify.NeedGM"));
  game.socket.emit(SOCKET, { type: "requestReveal", actorUuid: actor.uuid, userId: game.user.id });
  if (game.settings.get(MODULE_ID, SETTINGS.gmVerify)) ui.notifications.info(localize("Notify.AskedGM"));
}

/** Runs on every client; only the active GM acts on requests. */
export async function onSocketMessage(message) {
  if (message.type === "revealDenied") {
    if (message.userId === game.user.id) ui.notifications.info(localize("Notify.Denied", { name: message.actorName }));
    return;
  }
  if (!game.users.activeGM?.isSelf) return;
  const actor = await fromUuid(message.actorUuid);
  if (!actor) return;

  if (message.type === "requestSeal") return sealDeathSave(actor);
  if (message.type !== "requestReveal" || !hasPendingSeal(actor)) return;

  const requester = game.users.get(message.userId);
  if (game.settings.get(MODULE_ID, SETTINGS.gmVerify) && !requester?.isGM) {
    if (verifying.has(actor.id)) return;
    verifying.add(actor.id);
    let approved;
    try {
      approved = await foundry.applications.api.DialogV2.confirm({
        window: { title: localize("Verify.Title"), icon: "fa-solid fa-skull" },
        content: `<p>${localize("Verify.Body", {
          user: Handlebars.escapeExpression(requester?.name ?? "?"),
          name: Handlebars.escapeExpression(actor.name)
        })}</p>`,
        rejectClose: false
      });
    } finally {
      verifying.delete(actor.id);
    }
    if (!approved) {
      game.socket.emit(SOCKET, { type: "revealDenied", userId: message.userId, actorName: actor.name });
      return;
    }
  }
  return revealDeathSave(actor, message.userId);
}

function sealedCardHtml(actor) {
  const name = Handlebars.escapeExpression(actor.name);
  return `<div class="mdm-chat mdm-chat--sealed">
    <h3><i class="fa-solid fa-envelope"></i> ${localize("Chat.SealedTitle")}</h3>
    <p>${localize("Chat.SealedBody", { name })}</p>
    <button type="button" data-mdm-open="${actor.uuid}"><i class="fa-solid fa-eye-slash"></i> ${localize("Chat.Open")}</button>
  </div>`;
}

function revealedCardHtml(actor, result) {
  const name = Handlebars.escapeExpression(actor.name);
  const outcome = result.results.map(r => `<div class="mdm-result">${r.description || Handlebars.escapeExpression(r.name)}</div>`).join("");
  return `<div class="mdm-chat mdm-chat--revealed">
    <h3><i class="fa-solid fa-skull"></i> ${localize("Chat.RevealedTitle", { name })}</h3>
    <p class="mdm-roll">${result.formula} = <strong>${result.total}</strong></p>
    ${outcome}
  </div>`;
}
