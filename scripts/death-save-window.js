import { FLAG, MODULE_ID, SETTINGS, localize } from "./constants.js";
import { discardSeal, getSeal, requestReveal } from "./seal.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function enrich(html) {
  const editor = foundry.applications.ux?.TextEditor?.implementation ?? TextEditor;
  return editor.enrichHTML(html ?? "");
}

/**
 * The pop-up every client sees while a Death Save is sealed, and again when it is revealed.
 * While sealed, the result is never put in the DOM: the redaction is placeholder bars, not blurred text.
 */
export class DeathSaveWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["mdm-death-save"],
    window: { icon: "fa-solid fa-skull", resizable: false },
    position: { width: 440, height: "auto" },
    actions: {
      check: DeathSaveWindow.onCheck,
      discard: DeathSaveWindow.onDiscard
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/death-save.hbs` }
  };

  /** Set for the one render that should play the reveal animation. */
  #playReveal = false;

  constructor(actor, options = {}) {
    super({ ...options, id: `${MODULE_ID}-${actor.id}` });
    this.actor = actor;
  }

  get title() {
    return localize("Window.Title", { name: this.actor.name });
  }

  static find(actor) {
    return foundry.applications.instances.get(`${MODULE_ID}-${actor.id}`);
  }

  static show(actor, { reveal = false } = {}) {
    const app = DeathSaveWindow.find(actor) ?? new DeathSaveWindow(actor);
    app.#playReveal = reveal;
    return app.render({ force: true });
  }

  /** Called on every client when this module's flag on an actor changes. */
  static onSealChanged(actor, changes) {
    const seal = getSeal(actor);
    if (!seal) return DeathSaveWindow.find(actor)?.close();
    const justRevealed = foundry.utils.getProperty(changes, `flags.${MODULE_ID}.${FLAG}.revealed`) === true;
    if (justRevealed) return DeathSaveWindow.show(actor, { reveal: true });
    if (!seal.revealed) return DeathSaveWindow.show(actor);
  }

  async _prepareContext(options) {
    const seal = getSeal(this.actor);
    const isGM = game.user.isGM;
    const context = {
      name: this.actor.name,
      img: this.actor.img,
      seal,
      sealed: Boolean(seal && !seal.revealed),
      revealed: Boolean(seal?.revealed),
      isGM,
      animate: this.#playReveal,
      checkLabel: localize(!isGM && game.settings.get(MODULE_ID, SETTINGS.gmVerify) ? "Window.AskGM" : "Window.Check"),
      redactions: [88, 72, 94, 60]
    };
    if (context.revealed) {
      context.total = seal.result.total;
      context.formula = seal.result.formula;
      context.results = await Promise.all(seal.result.results.map(async r => ({
        name: r.name,
        html: await enrich(r.description || r.name)
      })));
    }
    return context;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#playReveal = false;
  }

  static async onCheck() {
    requestReveal(this.actor);
  }

  static async onDiscard() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: localize("Discard.Title") },
      content: `<p>${localize("Discard.Body", { name: Handlebars.escapeExpression(this.actor.name) })}</p>`,
      rejectClose: false
    });
    if (confirmed) await discardSeal(this.actor);
  }
}
