import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, copyFile, rename, rm, stat } from "node:fs/promises"
import { resolve, join } from "node:path"
class CodecInputError extends Error {}
const [source, destination] = process.argv.slice(2)
if (!source || !destination)
  throw new CodecInputError("Usage: stage-codec.mjs archive context-directory")
const directory = resolve(destination)
const size = (await stat(source)).size
if (size < 1 || size > 268435456)
  throw new CodecInputError("Codec archive exceeds build input bound")
await mkdir(directory, { recursive: true, mode: 0o700 })
const temporary = join(directory, "codec.tar.xz.partial")
try {
  await copyFile(source, temporary)
  const digest = createHash("sha256")
  for await (const chunk of createReadStream(temporary)) digest.update(chunk)
  if (
    digest.digest("hex") !==
    "da49baa2fd544ac090fa8adac19d2d6d1f781e75556c4f95dcc0a4f2dd22b1a6"
  )
    throw new CodecInputError("Codec archive does not match reviewed bytes")
  await rename(temporary, join(directory, "codec.tar.xz"))
  console.log("Reviewed codec build context ready")
} finally {
  await rm(temporary, { force: true })
}
