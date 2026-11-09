/**
 * Strip markdown heading syntax (#, ##, ###) from a bio.
 * Headings are not allowed in bios — they shout and break the visual flow
 * of profile cards.
 */
export function stripBioHeadings(bio: string): string {
  return bio.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "");
}
