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
    ![
      "da49baa2fd544ac090fa8adac19d2d6d1f781e75556c4f95dcc0a4f2dd22b1a6",
      "e414c137c7d6ed089c75d0887165f9a5fc1feb38bb6883f31d27fef0c00a03e4",
    ].includes(digest.digest("hex"))
  )
    throw new CodecInputError("Codec archive does not match reviewed bytes")
  await rename(temporary, join(directory, "codec.tar.xz"))
  console.log("Reviewed codec build context ready")
} finally {
  await rm(temporary, { force: true })
}
