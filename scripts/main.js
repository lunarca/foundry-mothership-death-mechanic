import { MODULE_ID, SETTINGS, SOCKET, localize } from "./constants.js";
import { DeathSaveWindow } from "./death-save-window.js";
import {
  discardSeal,
  getSeal,
  hasPendingSeal,
  hasReachedMaxWounds,
  onSocketMessage,
  requestReveal,
  requestSeal,
  resolveActor,
  sealDeathSave
} from "./seal.js";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SETTINGS.autoSeal, {
    name: "MDM.Settings.AutoSeal.Name",
    hint: "MDM.Settings.AutoSeal.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, SETTINGS.gmVerify, {
    name: "MDM.Settings.GMVerify.Name",
    hint: "MDM.Settings.GMVerify.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
  game.settings.register(MODULE_ID, SETTINGS.showDice, {
    name: "MDM.Settings.ShowDice.Name",
    hint: "MDM.Settings.ShowDice.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
});

Hooks.once("ready", () => {
  game.socket.on(SOCKET, onSocketMessage);

  game.modules.get(MODULE_ID).api = {
    seal: requestSeal,
    reveal: requestReveal,
    open: actor => {
      actor = resolveActor(actor);
      if (!actor || !getSeal(actor)) return ui.notifications.warn(localize("Notify.NothingSealed", { name: actor?.name ?? "?" }));
      return DeathSaveWindow.show(actor);
    },
    discard: actor => discardSeal(resolveActor(actor))
  };

  // Anyone joining while a character's fate is sealed sees the window too.
  for (const actor of game.actors) {
    if (hasPendingSeal(actor)) DeathSaveWindow.show(actor);
  }
});

Hooks.on("updateActor", (actor, changes) => {
  if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) DeathSaveWindow.onSealChanged(actor, changes);

  // Wounds can change through the system, other modules or a sheet edit; one GM client watches them all.
  if (!game.users.activeGM?.isSelf || !game.settings.get(MODULE_ID, SETTINGS.autoSeal)) return;
  if (foundry.utils.hasProperty(changes, "system.hits") && hasReachedMaxWounds(actor)) sealDeathSave(actor);
});

Hooks.on("renderChatMessageHTML", (message, html) => {
  for (const button of html.querySelectorAll("[data-mdm-open]")) {
    button.addEventListener("click", async () => {
      const actor = await fromUuid(button.dataset.mdmOpen);
      if (actor && getSeal(actor)) DeathSaveWindow.show(actor);
    });
  }
});
