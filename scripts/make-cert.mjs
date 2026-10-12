// Creates a self-signed HTTPS certificate for `npm run dev:phone`.
//
// Phones only allow location access on HTTPS pages, so the dev server has to
// be served over HTTPS to test "My location" on a phone. The certificate
// covers localhost and every IPv4 address of this machine, and is only
// regenerated when those addresses change (otherwise the phone would have to
// accept a new certificate every run).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const certDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'certs')
const keyFile = join(certDir, 'dev-key.pem')
const certFile = join(certDir, 'dev-cert.pem')
const stampFile = join(certDir, 'addresses.txt')

const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((entry) => entry && entry.family === 'IPv4')
  .map((entry) => entry.address)
  .sort()
const stamp = addresses.join(',')

if (existsSync(keyFile) && existsSync(certFile) && existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp) {
  console.log(`HTTPS certificate is up to date for ${addresses.join(', ')}`)
  process.exit(0)
}

// openssl ships with Git for Windows; fall back to whatever is on PATH.
const candidates = [
  'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
  'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
  'openssl',
]
const openssl = candidates.find((candidate) => candidate === 'openssl' || existsSync(candidate))

mkdirSync(certDir, { recursive: true })
// A minimal config of our own: OPENSSL_CONF may point at another program's
// (possibly missing) file, e.g. the PostgreSQL ODBC driver sets one.
const configFile = join(certDir, 'openssl.cnf')
writeFileSync(configFile, '[req]\ndistinguished_name = dn\n[dn]\n')
const subjectAltName = ['DNS:localhost', ...addresses.map((address) => `IP:${address}`)].join(',')
execFileSync(
  openssl,
  [
    'req', '-config', configFile, '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '825',
    '-keyout', keyFile, '-out', certFile,
    '-subj', '/CN=COS Indoor Navigation (dev)',
    '-addext', `subjectAltName=${subjectAltName}`,
  ],
  { stdio: 'inherit', env: { ...process.env, OPENSSL_CONF: configFile } },
)
writeFileSync(stampFile, stamp)
console.log(`Created HTTPS certificate for localhost, ${addresses.join(', ')}`)
