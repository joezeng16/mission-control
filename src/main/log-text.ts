/** What may reach the log file: every line is cleaned here first. Long token-like strings (API keys, session ids, JWTs)
 *  become [hidden], and anything shaped like a brokerage account number keeps only its last 4 ("5QZ12345" -> "••2345"). */

/** 32 or more key-like characters in a row: never readable in a log. */
const TOKEN_LIKE = /[A-Za-z0-9_\-+~]{32,}/g

export function redact(text: string): string {
  return text.replace(TOKEN_LIKE, '[hidden]')
}

/** 8 to 12 letters and digits with at least 4 digits, standing alone: not inside a longer word, a UUID or a date
 *  (those touch "-", ".", "/" or ":"), so order ids, timestamps and file names stay readable. */
const ACCOUNT_LIKE = /(?<![A-Za-z0-9\-_./:])(?=(?:[A-Za-z]*\d){4})[A-Za-z0-9]{8,12}(?![A-Za-z0-9\-_/:]|\.[A-Za-z0-9])/g

export function maskAccountNumbers(text: string): string {
  return text.replace(ACCOUNT_LIKE, (n) => `••${n.slice(-4)}`)
}

export function cleanLogLine(line: string): string {
  return maskAccountNumbers(redact(line))
}
