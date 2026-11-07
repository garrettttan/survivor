// The replay's result as plain JSON, the same way get-draft-data sends it (Maps become objects, Sets arrays)
import { jsonReplacer, type CastawayState } from "../_shared/replay.ts";

export function replayJson(castaways: Map<number, CastawayState>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(castaways, jsonReplacer));
}
