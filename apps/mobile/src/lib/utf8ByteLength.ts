/**
 * UTF-8 length of a string. Both notification payload contracts cap their
 * serialized form in BYTES, and a character cap would admit about three times
 * as much in a non-Latin script, so the two share one counter.
 */
export function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      // A surrogate pair is one four-byte character; skip its low half.
      bytes += 4
      index += 1
    } else bytes += 3
  }
  return bytes
}
