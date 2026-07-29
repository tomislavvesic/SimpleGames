export const oneWayOutManifest = Object.freeze({
  id: "one-way-out",
  title: "One Way Out",
  route: "/games/one-way-out",
  legacyQuery: null,
  category: "Solo",
  players: "1 player",
  description: "A tiny maze that changes every time you blink. Find the exit before time does.",
  featured: false,
  profileId: "one-way-out",
  launchAttribute: "data-play-maze",
  art: Object.freeze({
    className: "maze-art",
    markup: "<div></div><span>◆</span>",
  }),
  load: () => import("./client/index.js"),
});
