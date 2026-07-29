export const signalCrewManifest = Object.freeze({
  id: "signal-crew",
  title: "Signal Crew",
  route: "/games/signal-crew",
  legacyQuery: "signal",
  category: "Co-op",
  players: "2–4 players",
  description: "Keep a tiny station alive together. Match the signals before the whole system goes dark.",
  featured: false,
  profileId: "signal-crew",
  launchAttribute: "data-play-signal",
  art: Object.freeze({
    className: "rhythm-art",
    markup: "<span>♪</span><span>●</span><span>♪</span>",
  }),
  load: () => import("./client/index.js"),
});
