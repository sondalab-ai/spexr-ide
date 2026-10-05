import tokens from "../../sondalab.tokens.json";

/** The token names a probe may read, in the order the file declares them. */
export const TOKEN_NAMES: readonly string[] = Object.keys(tokens.tokens);

/** A token's value, or undefined when the file does not declare it. */
export function token(name: string): string | number | undefined {
  return (tokens.tokens as Record<string, string | number>)[name];
}
