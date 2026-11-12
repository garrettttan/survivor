// The short-name rule shared with the site (js/shared/util.js shortNames()): nickname, else first name, else first word,
// with a last initial on a clash and the full name if that still clashes.

import { assertEquals } from "jsr:@std/assert@1";
import { shortNames, type NamedCastaway } from "../_shared/short-names.ts";

const c = (name: string, firstName: string | null, lastName: string | null, nickname: string | null = null): NamedCastaway =>
  ({ name, firstName, lastName, nickname });
const short = (castaways: NamedCastaway[]) => Object.fromEntries(shortNames(castaways));

Deno.test("short names: the nickname, else the first name", () => {
  assertEquals(short([c("Danny Kilby", "Danny", "Kilby", "Kilby"), c("Kristin Flickinger", "Kristin", "Flickinger"),
    c("Thien An Nguyen", "Thien An", "Nguyen")]), { "Danny Kilby": "Kilby", "Kristin Flickinger": "Kristin", "Thien An Nguyen": "Thien An" });
});

Deno.test("short names: a clash adds a last initial, and the full name if that still clashes", () => {
  assertEquals(short([c("John Adams", "John", "Adams"), c("John Carter", "John", "Carter")]),
    { "John Adams": "John A.", "John Carter": "John C." });
  assertEquals(short([c("John Adams", "John", "Adams"), c("John Anders", "John", "Anders"), c("Mo Lee", "Mo", "Lee")]),
    { "John Adams": "John Adams", "John Anders": "John Anders", "Mo Lee": "Mo" });
  // A nickname can clash with a first name
  assertEquals(short([c("Angelica Loblack", "Angelica", "Loblack", "Jelly"), c("Jelly Smith", "Jelly", "Smith")]),
    { "Angelica Loblack": "Jelly L.", "Jelly Smith": "Jelly S." });
});

Deno.test("short names: without a last name, the initial comes from the rest of the name", () => {
  assertEquals(short([c("Thien An Nguyen", "Thien An", null), c("Thien An Tran", "Thien An", null)]),
    { "Thien An Nguyen": "Thien An N.", "Thien An Tran": "Thien An T." });
  assertEquals(short([c("Madonna", null, null), c("Madonna Ray", null, null), c("Cher", "", "", "")]),
    { "Madonna": "Madonna", "Madonna Ray": "Madonna R.", "Cher": "Cher" });
});
