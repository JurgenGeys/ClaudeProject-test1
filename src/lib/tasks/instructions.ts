/**
 * First non-empty line of the instructions: the short description in lists (design B2, T1).
 * The rest of the text is shown on the task page.
 */
export function firstLine(instructions: string): string {
  return (
    instructions
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line !== "") ?? ""
  );
}
