export const MODULE_ID = "mothership-death-mechanic";
export const SOCKET = `module.${MODULE_ID}`;
export const FLAG = "seal";

export const SETTINGS = {
  autoSeal: "autoSeal",
  gmVerify: "gmVerify",
  showDice: "showDice"
};

export function localize(key, data) {
  const path = `MDM.${key}`;
  return data ? game.i18n.format(path, data) : game.i18n.localize(path);
}
