import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
} from "node:crypto"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

export const AUDIENCE = "https://web-staging-7801.up.railway.app"
const SERVICE = "org.jesusfilm.forge.tv.feedback-simulator.signing"
const ACCOUNT = "simulator-issuer-v1"

export function publicIdentity(privateKey) {
  if (privateKey.asymmetricKeyType !== "ed25519")
    throw new Error("Expected an Ed25519 signing key")
  const publicKey = createPublicKey(privateKey)
  const der = publicKey.export({ type: "spki", format: "der" })
  return {
    kid: createHash("sha256").update(der).digest("hex").slice(0, 16),
    pem: publicKey.export({ type: "spki", format: "pem" }),
  }
}

/**
 * @param {import("node:crypto").KeyObject} privateKey
 * @param {{ ttl?: number, now?: number, id?: string }} options
 */
export function issueLink(
  privateKey,
  { ttl = 3600, now = Math.floor(Date.now() / 1000), id = randomUUID() } = {},
) {
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 7200)
    throw new Error("TTL must be 60–7200 seconds")
  if (
    !Number.isInteger(now) ||
    now < 0 ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
  )
    throw new Error("Invalid issuance metadata")
  const { kid } = publicIdentity(privateKey)
  const header = { alg: "EdDSA", typ: "JWT", kid }
  const claims = {
    iss: "forge-tv-simulator",
    aud: AUDIENCE,
    scope: "tv-feedback:simulator",
    iat: now,
    exp: now + ttl,
    jti: id,
  }
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url")
  const unsigned = `${encode(header)}.${encode(claims)}`
  const token = `${unsigned}.${sign(null, Buffer.from(unsigned), privateKey).toString("base64url")}`
  return {
    url: `${AUDIENCE}/tv/simulator#token=${token}`,
    kid,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  }
}

export function updateTvEnvironment(contents, url) {
  const updates = new Map([
    // dotenv treats an unquoted # as a comment, including URL fragments.
    ["EXPO_PUBLIC_TV_FEEDBACK_URL", JSON.stringify(url)],
    ["EXPO_PUBLIC_TV_FEEDBACK_SIMULATOR_ENABLED", "true"],
  ])
  const lines = contents.split(/\r?\n/).filter((line) => {
    const match = /^\s*(?:export\s+)?([A-Z_]+)\s*=/.exec(line)
    return !match || !updates.has(match[1])
  })
  while (lines.at(-1) === "") lines.pop()
  return [
    ...lines,
    ...[...updates].map(([key, value]) => `${key}=${value}`),
    "",
  ].join("\n")
}

export function privateWrite(filename, contents) {
  if (fs.existsSync(filename) && !fs.lstatSync(filename).isFile())
    throw new Error("Output must be a regular file")
  // Never follow a symlink or truncate a file before its restricted mode is applied.
  const fd = fs.openSync(
    filename,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW,
    0o600,
  )
  try {
    fs.fchmodSync(fd, 0o600)
    fs.ftruncateSync(fd, 0)
    fs.writeFileSync(fd, contents)
  } finally {
    fs.closeSync(fd)
  }
}

function keychainItem(service, account, { initialize = false } = {}) {
  if (process.platform !== "darwin")
    throw new Error("This issuer uses macOS Keychain")
  if (
    ![service, account].every((value) => /^[A-Za-z0-9._:-]{1,128}$/.test(value))
  )
    throw new Error("Invalid Keychain service/account name")
  const read = () =>
    spawnSync(
      "security",
      ["find-generic-password", "-s", service, "-a", account, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    )
  let result = read()
  if (result.status !== 0) {
    if (!initialize || result.status !== 44)
      throw new Error("Signing key unavailable; run init or unlock Keychain")
    const { privateKey } = generateKeyPairSync("ed25519")
    const secret = privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("base64")
    // DER base64 and validated identifiers cannot inject a security interactive command.
    // The private key travels over stdin, never shell arguments or printed output.
    spawnSync("security", ["-i"], {
      input: `add-generic-password -s '${service}' -a '${account}' -l 'Watch TV Simulator Signing' -w '${secret}'\n`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    })
    result = read()
    if (result.status !== 0 || result.stdout.trim() !== secret)
      throw new Error("Keychain save verification failed")
  }
  const stored = result.stdout.trim()
  result.stdout = ""
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(stored))
    throw new Error("Invalid stored signing key")
  const privateKey = createPrivateKey({
    key: Buffer.from(stored, "base64"),
    type: "pkcs8",
    format: "der",
  })
  publicIdentity(privateKey)
  return privateKey
}

export function main(args = process.argv.slice(2)) {
  process.umask(0o077)
  const [command, ...rest] = args
  if (!["init", "issue"].includes(command))
    throw new Error(
      "Use init --public-key-out PATH or issue --output PATH [--tv-env PATH] [--ttl 3600]",
    )
  const options = {}
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index]
    if (
      ![
        "--public-key-out",
        "--output",
        "--tv-env",
        "--ttl",
        "--service",
        "--account",
      ].includes(name) ||
      !rest[index + 1] ||
      rest[index + 1].startsWith("--") ||
      options[name]
    )
      throw new Error("Invalid or duplicate option")
    options[name] = rest[index + 1]
  }
  const filename = options[command === "init" ? "--public-key-out" : "--output"]
  if (!filename) throw new Error("Output path is required")
  if (!fs.statSync(path.dirname(path.resolve(filename))).isDirectory())
    throw new Error("Output parent directory is required")
  if (
    options["--tv-env"] &&
    !/\.env(?:\.development)?\.local$/.test(path.basename(options["--tv-env"]))
  )
    throw new Error(
      "TV environment must be an ignored .env.local or .env.development.local file",
    )
  if (command === "issue") {
    const repo = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
    for (const destination of [filename, options["--tv-env"]].filter(Boolean)) {
      if (
        fs.existsSync(destination) &&
        fs.lstatSync(destination).isSymbolicLink()
      )
        throw new Error("Private output cannot be a symlink")
      if (repo.status === 0) {
        const relative = path.relative(
          repo.stdout.trim(),
          path.resolve(destination),
        )
        if (
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative)
        ) {
          const ignored = spawnSync(
            "git",
            ["check-ignore", "--quiet", "--", path.resolve(destination)],
            { stdio: "ignore" },
          )
          if (ignored.status !== 0)
            throw new Error(
              "Bearer output inside a repository must be Git-ignored and untracked",
            )
        }
      }
    }
  }
  const ttl = options["--ttl"] === undefined ? 3600 : Number(options["--ttl"])
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 7200)
    throw new Error("TTL must be 60–7200 seconds")
  const privateKey = keychainItem(
    options["--service"] ?? SERVICE,
    options["--account"] ?? ACCOUNT,
    { initialize: command === "init" },
  )
  const identity = publicIdentity(privateKey)
  if (command === "init") {
    if (fs.existsSync(filename)) {
      if (
        fs.lstatSync(filename).isSymbolicLink() ||
        fs.readFileSync(filename, "utf8") !== identity.pem
      )
        throw new Error("Refusing to replace a different public-key file")
    } else fs.writeFileSync(filename, identity.pem, { flag: "wx", mode: 0o644 })
    console.log(
      JSON.stringify({
        initialized: true,
        kid: identity.kid,
        publicKeyFile: path.resolve(filename),
        privateKeyStorage: "macOS Keychain",
      }),
    )
  } else {
    const link = issueLink(privateKey, { ttl })
    privateWrite(filename, `${link.url}\n`)
    if (options["--tv-env"]) {
      const envFile = options["--tv-env"]
      if (fs.existsSync(envFile) && fs.lstatSync(envFile).isSymbolicLink())
        throw new Error("TV environment cannot be a symlink")
      const existing = fs.existsSync(envFile)
        ? fs.readFileSync(envFile, "utf8")
        : ""
      privateWrite(envFile, updateTvEnvironment(existing, link.url))
    }
    console.log(
      JSON.stringify({
        kid: link.kid,
        expiresAt: link.expiresAt,
        signedLinkFile: path.resolve(filename),
        tvEnvironmentUpdated: Boolean(options["--tv-env"]),
      }),
    )
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    main()
  } catch {
    console.error(
      "Simulator issuer failed. Check the command, output permissions and Keychain access; no secret has been printed.",
    )
    process.exitCode = 1
  }
}
