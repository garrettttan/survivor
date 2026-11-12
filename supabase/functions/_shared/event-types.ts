// Event types by id. Code names an event type only by its id here, never by its name: names are labels an admin can
// edit in the database, and a renamed type must keep working. The ids are the live project's event_types.id.
//
// A new event type gets a fixed id: its migration inserts it with `overriding system value` and the next number, and
// it gets a line here.

export const EVENT_TYPE = {
  startingTribe: 1,
  swappedTribes: 2,
  merged: 3,
  foundAdvantage: 4,
  receivedAdvantage: 5,
  gaveAwayAdvantage: 6,
  playedAdvantageSuccessfully: 7,
  wastedAdvantage: 8,
  advantageExpired: 9,
  hadAdvantagePlayedForThem: 10,
  wonIndividualImmunity: 11,
  wonIndividualReward: 12,
  wonTeamImmunity: 13,
  wonTeamImmunitySecond: 14,
  wonTeamReward: 15,
  wonTeamRewardSecond: 16,
  broughtOnReward: 17,
  votedCorrectly: 18,
  votedIncorrectly: 19,
  receivedJuryVote: 20,
  votedOut: 21,
  medicallyEvacuated: 22,
  quit: 23,
  hadIconicMoment: 24,
  criedOnCamera: 25,
  wentHomeOnRocks: 26,
  satOutOfChallenge: 27,
  episodePoints: 29,                             // Legacy: old seasons' lump points
  lostFireMaking: 30,
  switchedTribes: 31,
  soleSurvivor: 32,
  shotNotSafe: 33,                               // played Shot in the Dark, and it didn't save them
  shotSafe: 34,                                  // played Shot in the Dark, and it saved them
  receivedVote: 37,                              // a final-round vote was cast for them, and it counted
  receivedNullifiedVote: 38,                     // a final-round vote was cast for them, but they were safe
} as const;

/** Challenge wins: format → prize → [1st place, 2nd place] (an individual challenge has no 2nd place) */
export const WIN_TYPES = {
  individual: { immunity: [EVENT_TYPE.wonIndividualImmunity, null], reward: [EVENT_TYPE.wonIndividualReward, null] },
  team: {
    immunity: [EVENT_TYPE.wonTeamImmunity, EVENT_TYPE.wonTeamImmunitySecond],
    reward: [EVENT_TYPE.wonTeamReward, EVENT_TYPE.wonTeamRewardSecond],
  },
} as const;

/** A challenge win's format, prize and place, or undefined for any other event type */
export function winOf(eventTypeId: number): { format: "individual" | "team"; prize: "immunity" | "reward"; second: boolean } | undefined {
  for (const [format, prizes] of Object.entries(WIN_TYPES)) {
    for (const [prize, [first, second]] of Object.entries(prizes)) {
      if (eventTypeId === first || eventTypeId === second) {
        return { format: format as "individual" | "team", prize: prize as "immunity" | "reward", second: eventTypeId === second };
      }
    }
  }
}
