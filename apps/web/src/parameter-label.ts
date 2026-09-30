/** Rest after " - " counts as a description only from this length and when it is longer than the name before it. */
const MIN_DESCRIPTION = 25;
/** A hyphen or en dash with a space on both sides; "Trailing-SL" or "Signal-Kerze" never match. */
const SEPARATOR = /\s[-–]\s/;

/**
 * Parameters have no description field, so bots often put one into the label: "Excluded times - One or more times
 * [hh:mm-hh:mm] …". Splits that into a short name and the description, for display only; the label itself is unchanged.
 * Short rests ("Risk - Reward") stay part of the name.
 */
export function splitLabel(label: string): { title: string; description?: string } {
  const match = SEPARATOR.exec(label);
  if (!match) return { title: label };
  const title = label.slice(0, match.index).trim();
  const description = label.slice(match.index + match[0].length).trim();
  if (!title || description.length < MIN_DESCRIPTION || description.length <= title.length) return { title: label };
  return { title, description };
}
