// Made-up event types for the tests, with their real ids (_shared/event-types.ts) and live names, so a test can build
// rows by id and still print them readably.

import { EVENT_TYPE as E } from "../_shared/event-types.ts";
import type { EventType } from "../episode-entry/cards.ts";

export const TYPE_NAME: Record<number, string> = {
  [E.startingTribe]: "Starting tribe", [E.swappedTribes]: "Swapped tribes", [E.merged]: "Merged",
  [E.foundAdvantage]: "Found advantage", [E.receivedAdvantage]: "Received advantage",
  [E.gaveAwayAdvantage]: "Gave away advantage", [E.playedAdvantageSuccessfully]: "Played advantage successfully",
  [E.wastedAdvantage]: "Wasted advantage", [E.advantageExpired]: "Advantage expired",
  [E.hadAdvantagePlayedForThem]: "Had advantage played for them",
  [E.wonIndividualImmunity]: "Won individual immunity", [E.wonIndividualReward]: "Won individual reward",
  [E.wonTeamImmunity]: "Won team immunity", [E.wonTeamImmunitySecond]: "Won team immunity (2nd place)",
  [E.wonTeamReward]: "Won team reward", [E.wonTeamRewardSecond]: "Won team reward (2nd place)",
  [E.broughtOnReward]: "Brought on reward", [E.votedCorrectly]: "Voted correctly", [E.votedIncorrectly]: "Voted incorrectly",
  [E.receivedJuryVote]: "Received a jury vote", [E.votedOut]: "Voted out", [E.medicallyEvacuated]: "Medically evacuated",
  [E.quit]: "Quit", [E.hadIconicMoment]: "Had an iconic moment", [E.criedOnCamera]: "Cried on camera",
  [E.wentHomeOnRocks]: "Went home on rocks", [E.satOutOfChallenge]: "Sat out of challenge",
  [E.episodePoints]: "Episode points", [E.lostFireMaking]: "Lost fire-making", [E.switchedTribes]: "Switched tribes",
  [E.soleSurvivor]: "Became Sole Survivor", [E.shotNotSafe]: "Played Shot in the Dark (not safe)",
  [E.shotSafe]: "Played Shot in the Dark (safe)", [E.receivedVote]: "Received a vote",
  [E.receivedNullifiedVote]: "Received a nullified vote",
};

const ENDS_GAME = new Set<number>([E.votedOut, E.wentHomeOnRocks, E.medicallyEvacuated, E.quit, E.lostFireMaking]);
const CHANGES_TRIBE = new Set<number>([E.startingTribe, E.swappedTribes, E.switchedTribes, E.merged]);

/** An event type as the card rules see it: ends the game or changes tribe as the real one does, and 0 points */
export function testType(id: number, extra: Partial<EventType> = {}): EventType {
  return {
    id, category: "Test", name: TYPE_NAME[id], changesTribe: CHANGES_TRIBE.has(id), endsGame: ENDS_GAME.has(id),
    advantageEffect: null, points: 0, ...extra,
  };
}

/** Event types by id */
export function testTypes(types: EventType[]): Map<number, EventType> {
  return new Map(types.map(t => [t.id, t]));
}
