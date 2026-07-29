export const fourSidesManifest = Object.freeze({
  id: "four-sides",
  title: "Four Sides",
  route: "/games/four-sides",
  legacyQuery: "room",
  category: "Multiplayer",
  players: "1–4 players",
  description: "Claim one side, share a room link, and defend your edge against friends or bots.",
  featured: true,
  profileId: "four-sides",
  launchAttribute: "data-play",
  art: Object.freeze({
    className: "arena-art",
    markup: `
      <div class="mini-arena">
        <i class="mini-paddle top"></i><i class="mini-paddle right"></i>
        <i class="mini-paddle bottom"></i><i class="mini-paddle left"></i>
        <b class="mini-ball one"></b><b class="mini-ball two"></b>
        <span>4</span>
      </div>
      <div class="art-grid"></div>
    `,
  }),
  load: () => import("./client/index.js"),
});
