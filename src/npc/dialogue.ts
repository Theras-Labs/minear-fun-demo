// Port of play-inUT-NSi.js 69899-69923 (dR, the Stranger's line sets) and 69986-69988 (mR, hR, gR).
// The soul table sR / cR / uR is src/pickups/souls.ts.

export type StrangerTalkKey = 'silent' | 'gift' | 'stone' | 'awake' | 'retune' | 'waiting' | 'done';

/** dR (69899): the Stranger's lines by quest stage; KR.talkToStranger cycles each set with state.strangerTalk. */
export const STRANGER_LINES: Record<StrangerTalkKey, string[]> = { // dR (69899)
  silent: [`...`],
  gift: [`...You went down. And came back. Take this. Watch your compass: it points to what sleeps below.`],
  stone: [`Follow the mark on your compass.`, `It sleeps deeper than you have been.`, `...`],
  awake: [
    `Your people are different. You love the earth, and you keep close to it.`,
    `Four mythical beasts sleep beneath the grass. Fire. Venom. Frost. Bone.`,
    `Bring me their souls.`,
    `So deep you mine. Have you never once looked up?`,
    `The sky was not always this empty.`,
  ],
  retune: [`The mark on your compass turns to the next.`],
  waiting: [`The sky is listening.`, `Their souls remember where they fell from.`, `The deep holds the rest. Go.`],
  done: [`The sky remembers you.`, `Look up. It is open to you now.`, `Your people were never meant to stay below.`],
};

/** mR (69986): the Stranger's offset from the hub (LIFT_POINT). MINEAR base: moved inside the ring of sites (was 8.5, -4). */
export const STRANGER_OFFSET = { x: 6.59, z: -0.35 }; // mR (69986)
/** hR (69987): the Mirror's offset from the hub (LIFT_POINT). MINEAR base: moved inside the ring of sites (was -9.5, -7.5). */
export const MIRROR_OFFSET = { x: 4.5, z: 5.36 }; // hR (69987)
/** gR (69988): the count of beasts left, as a line. */
export const REMAIN_LINES = [``, `One remains.`, `Two remain.`, `Three remain.`, `Four remain.`]; // gR (69988)
