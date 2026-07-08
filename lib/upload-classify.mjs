/**
 * Map an HTTP status from the ingestion endpoint to the uploader's action:
 *  - "delete": 2xx success → remove the local file.
 *  - "keep":   408, 429, or 5xx → transient, retry on the next run.
 *  - "drop":   other 4xx → permanently bad (validation/auth), remove so it can't loop forever.
 *
 * Both SDKs (Unity + native) treat 408 Request Timeout as retryable; keep this in sync.
 */
export function classifyUploadResult(status) {
  if (status >= 200 && status < 300) return "delete";
  if (status === 408 || status === 429 || status >= 500) return "keep";
  return "drop";
}
