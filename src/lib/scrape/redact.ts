/** Strip credential-shaped fragments before a message is shown or logged to the client. */
export function redactSecrets(value: string): string {
  return value
    .replace(/api_key=[^&\s"'<>]+/gi, "api_key=***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(/(X-Browser-Use-API-Key["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, "$1***");
}
