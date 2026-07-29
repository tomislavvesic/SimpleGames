import { FOUR_SIDES } from "../shared/physics.js";

export const FOUR_SIDES_MODES = {
  duel: { label: "1 vs 1", sides: ["left", "right"], maxPlayers: 2 },
  teams: { label: "2 vs 2", sides: FOUR_SIDES, maxPlayers: 4 },
  ffa: { label: "Four for all", sides: FOUR_SIDES, maxPlayers: 4 },
};

export const FOUR_SIDES_COLORS = {
  left: "#ff725e",
  top: "#69a7ff",
  right: "#ffd45c",
  bottom: "#63d6ae",
};
