/**
 * The server renames every key in a JSON response to camelCase — including keys INSIDE stored
 * data, such as intake answers keyed by question id (`field_1_1790…` arrives as `field11790…`)
 * while the question ids themselves are values and stay as they are. Same rule as the server's
 * snakeToCamel (src/server/utils/caseConverter.ts); serverKeys.test.ts keeps them identical.
 */
export function serverKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Look a stored value up by its original key, whether or not the server renamed it */
export function valueFor<T = unknown>(values: Record<string, T> | null | undefined, key: string): T | undefined {
  if (!values) return undefined;
  return key in values ? values[key] : values[serverKey(key)];
}
