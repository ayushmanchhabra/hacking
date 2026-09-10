// Generates and persists a local root CA, the same role Burp Suite's
// "CA Certificate" export serves: a certificate the user imports into
// their browser/OS trust store once, so a proxy can (eventually) mint
// per-site leaf certificates it signs on the fly for TLS interception.
//
// node:crypto can generate and sign keys but has no API to build an
// X.509 certificate itself (X509Certificate only *parses* existing
// ones), so the handful of ASN.1/DER primitives below construct one
// directly. Output is verified against openssl and Node's own
// X509Certificate parser during development.
import {
  X509Certificate,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as cryptoSign,
  createHash,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// --- Minimal ASN.1 DER encoding ---

function derLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  const bytes: number[] = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n = Math.floor(n / 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTLV(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(value.length), value]);
}

function derSequence(...children: Buffer[]): Buffer {
  return derTLV(0x30, Buffer.concat(children));
}

function derSet(...children: Buffer[]): Buffer {
  return derTLV(0x31, Buffer.concat(children));
}

function derBoolean(value: boolean): Buffer {
  return derTLV(0x01, Buffer.from([value ? 0xff : 0x00]));
}

function derOctetString(content: Buffer): Buffer {
  return derTLV(0x04, content);
}

function derUTF8String(value: string): Buffer {
  return derTLV(0x0c, Buffer.from(value, "utf8"));
}

// INTEGER, given raw big-endian magnitude bytes: strips redundant
// leading 0x00 bytes, then re-adds a single 0x00 if the high bit would
// otherwise make the value read as negative.
function derPositiveInteger(raw: Buffer): Buffer {
  let bytes = raw;
  let start = 0;
  while (
    start < bytes.length - 1 &&
    bytes[start] === 0x00 &&
    (bytes[start + 1] & 0x80) === 0
  ) {
    start++;
  }
  bytes = bytes.subarray(start);
  if (bytes.length === 0) bytes = Buffer.from([0]);
  if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0x00]), bytes]);
  return derTLV(0x02, bytes);
}

function derSmallInteger(n: number): Buffer {
  if (n === 0) return derTLV(0x02, Buffer.from([0]));
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  if (bytes[0] & 0x80) bytes.unshift(0);
  return derTLV(0x02, Buffer.from(bytes));
}

// Base-128 encoding of a single OID arc, continuation bit set on all
// but the arc's last byte.
function encodeArc(n: number): number[] {
  if (n === 0) return [0];
  const out: number[] = [];
  let v = n;
  while (v > 0) {
    out.unshift(v & 0x7f);
    v = Math.floor(v / 128);
  }
  for (let i = 0; i < out.length - 1; i++) out[i] |= 0x80;
  return out;
}

function derOID(oid: string): Buffer {
  const parts = oid.split(".").map(Number);
  const bytes = [...encodeArc(parts[0] * 40 + parts[1])];
  for (let i = 2; i < parts.length; i++) bytes.push(...encodeArc(parts[i]));
  return derTLV(0x06, Buffer.from(bytes));
}

// UTCTime (YYMMDDHHMMSSZ) — valid for 1950-2049, which covers this
// CA's validity window.
function derUTCTime(date: Date): Buffer {
  const pad = (n: number) => String(n).padStart(2, "0");
  const value =
    `${pad(date.getUTCFullYear() % 100)}${pad(date.getUTCMonth() + 1)}` +
    `${pad(date.getUTCDate())}${pad(date.getUTCHours())}` +
    `${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  return derTLV(0x17, Buffer.from(value, "ascii"));
}

function derExplicitTag(n: number, inner: Buffer): Buffer {
  return derTLV(0xa0 | n, inner);
}

function derExtension(
  oid: string,
  critical: boolean,
  valueDer: Buffer,
): Buffer {
  const parts = [derOID(oid)];
  if (critical) parts.push(derBoolean(true));
  parts.push(derOctetString(valueDer));
  return derSequence(...parts);
}

function derAlgorithmIdentifierSha256Rsa(): Buffer {
  return derSequence(
    derOID("1.2.840.113549.1.1.11"),
    derTLV(0x05, Buffer.alloc(0)),
  );
}

function derRelativeDistinguishedName(oid: string, value: string): Buffer {
  return derSet(derSequence(derOID(oid), derUTF8String(value)));
}

function derName(entries: [string, string][]): Buffer {
  return derSequence(
    ...entries.map(([oid, value]) => derRelativeDistinguishedName(oid, value)),
  );
}

// --- Certificate ---

const COMMON_NAME_OID = "2.5.4.3";
const ORGANIZATION_OID = "2.5.4.10";
const BASIC_CONSTRAINTS_OID = "2.5.29.19";
const KEY_USAGE_OID = "2.5.29.15";
const SUBJECT_KEY_IDENTIFIER_OID = "2.5.29.14";
const AUTHORITY_KEY_IDENTIFIER_OID = "2.5.29.35";
const EXT_KEY_USAGE_OID = "2.5.29.37";
const SUBJECT_ALT_NAME_OID = "2.5.29.17";
const SERVER_AUTH_OID = "1.3.6.1.5.5.7.3.1";

// UTCTime tops out in 2049; that's a long enough CA lifetime for a
// local tool without reaching for GeneralizedTime.
const NOT_AFTER = new Date(Date.UTC(2049, 11, 31, 23, 59, 59));
const LEAF_VALIDITY_MS = 825 * 24 * 60 * 60 * 1000; // CA/Browser Forum's max leaf lifetime

export interface GeneratedCA {
  certPem: string;
  keyPem: string;
}

// issuer == subject for the root; leaf certs reuse this as their
// issuer, so it must stay byte-identical between the two call sites.
function caSubjectName(): Buffer {
  return derName([
    [COMMON_NAME_OID, "Localghost Root CA"],
    [ORGANIZATION_OID, "Localghost"],
  ]);
}

function generateSelfSignedCA(): GeneratedCA {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 65537,
  });
  const spkiDer = publicKey.export({ type: "spki", format: "der" });

  const subject = caSubjectName();

  // Not a strict RFC 5280 key identifier (that hashes just the
  // BIT STRING key bits, not the whole SPKI), but it only needs to be
  // a stable, unique identifier for our own future issued-cert
  // chaining — exactness here doesn't affect trust.
  const subjectKeyId = createHash("sha1").update(spkiDer).digest();

  const extensions = derExplicitTag(
    3,
    derSequence(
      derExtension(BASIC_CONSTRAINTS_OID, true, derSequence(derBoolean(true))),
      // keyCertSign (bit 5) + cRLSign (bit 6), 1 unused trailing bit.
      derExtension(
        KEY_USAGE_OID,
        true,
        derTLV(0x03, Buffer.from([0x01, 0x06])),
      ),
      derExtension(
        SUBJECT_KEY_IDENTIFIER_OID,
        false,
        derOctetString(subjectKeyId),
      ),
    ),
  );

  const tbsCertificate = derSequence(
    derExplicitTag(0, derSmallInteger(2)), // version: v3
    derPositiveInteger(randomBytes(16)), // serialNumber
    derAlgorithmIdentifierSha256Rsa(), // signature
    subject, // issuer (self-signed)
    derSequence(derUTCTime(new Date()), derUTCTime(NOT_AFTER)), // validity
    subject, // subject
    spkiDer, // subjectPublicKeyInfo
    extensions,
  );

  const signature = cryptoSign("sha256", tbsCertificate, privateKey);
  const signatureValue = derTLV(
    0x03,
    Buffer.concat([Buffer.from([0x00]), signature]),
  );

  const certDer = derSequence(
    tbsCertificate,
    derAlgorithmIdentifierSha256Rsa(),
    signatureValue,
  );

  return {
    certPem: toPem(certDer, "CERTIFICATE"),
    keyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
  };
}

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// GeneralName: dNSName [2] IMPLICIT IA5String, or iPAddress [7]
// IMPLICIT OCTET STRING for a literal IPv4 host.
function subjectAltNameEntry(hostname: string): Buffer {
  const octets = hostname.match(IPV4_PATTERN)?.slice(1).map(Number);
  if (octets && octets.every((octet) => octet <= 255)) {
    return derTLV(0x87, Buffer.from(octets));
  }
  return derTLV(0x82, Buffer.from(hostname, "ascii"));
}

export interface LeafCertificate {
  certPem: string;
  keyPem: string;
}

// Leaf certs only need to be trusted transitively through the already
// -imported CA, so unlike the CA itself they don't need to survive a
// restart — an in-memory, per-process cache is enough.
const leafCache = new Map<string, LeafCertificate>();

// Mints a certificate for `hostname`, signed by the persisted CA, for
// terminating TLS on an intercepted CONNECT tunnel.
export function getLeafCertificate(hostname: string): LeafCertificate {
  const cached = leafCache.get(hostname);
  if (cached) return cached;

  const ca = loadOrCreateCA();
  const caPrivateKey = createPrivateKey(ca.keyPem);
  const caSpkiDer = createPublicKey(caPrivateKey).export({
    type: "spki",
    format: "der",
  });
  const caSubjectKeyId = createHash("sha1").update(caSpkiDer).digest();

  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 65537,
  });
  const spkiDer = publicKey.export({ type: "spki", format: "der" });

  const now = new Date();
  const notBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const notAfter = new Date(
    Math.min(now.getTime() + LEAF_VALIDITY_MS, NOT_AFTER.getTime()),
  );

  const extensions = derExplicitTag(
    3,
    derSequence(
      // cA defaults to false, so an empty SEQUENCE is the DER-correct encoding.
      derExtension(BASIC_CONSTRAINTS_OID, true, derSequence()),
      // digitalSignature (bit 0) + keyEncipherment (bit 2), 5 unused trailing bits.
      derExtension(
        KEY_USAGE_OID,
        true,
        derTLV(0x03, Buffer.from([0x05, 0xa0])),
      ),
      derExtension(
        EXT_KEY_USAGE_OID,
        false,
        derSequence(derOID(SERVER_AUTH_OID)),
      ),
      // Critical: modern browsers ignore the CN and require a SAN.
      derExtension(
        SUBJECT_ALT_NAME_OID,
        true,
        derSequence(subjectAltNameEntry(hostname)),
      ),
      derExtension(
        AUTHORITY_KEY_IDENTIFIER_OID,
        false,
        derSequence(derTLV(0x80, caSubjectKeyId)),
      ),
    ),
  );

  const tbsCertificate = derSequence(
    derExplicitTag(0, derSmallInteger(2)), // version: v3
    derPositiveInteger(randomBytes(16)), // serialNumber
    derAlgorithmIdentifierSha256Rsa(), // signature
    caSubjectName(), // issuer
    derSequence(derUTCTime(notBefore), derUTCTime(notAfter)), // validity
    derName([[COMMON_NAME_OID, hostname]]), // subject
    spkiDer, // subjectPublicKeyInfo
    extensions,
  );

  const signature = cryptoSign("sha256", tbsCertificate, caPrivateKey);
  const signatureValue = derTLV(
    0x03,
    Buffer.concat([Buffer.from([0x00]), signature]),
  );

  const certDer = derSequence(
    tbsCertificate,
    derAlgorithmIdentifierSha256Rsa(),
    signatureValue,
  );

  const leaf: LeafCertificate = {
    certPem: toPem(certDer, "CERTIFICATE"),
    keyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
  };
  leafCache.set(hostname, leaf);
  return leaf;
}

function toPem(der: Buffer, label: string): string {
  const body =
    der
      .toString("base64")
      .match(/.{1,64}/g)
      ?.join("\n") ?? "";
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

function pemToDer(pem: string): Buffer {
  const body = pem.replace(/-----(BEGIN|END) CERTIFICATE-----|\s+/g, "");
  return Buffer.from(body, "base64");
}

// --- Persistence ---

function getCADir(): string {
  return join(homedir(), ".localghost");
}

function getCAPaths(): { certPath: string; keyPath: string } {
  const dir = getCADir();
  return {
    certPath: join(dir, "ca-cert.pem"),
    keyPath: join(dir, "ca-key.pem"),
  };
}

// Loads the persisted CA, generating and saving one on first run so it
// stays stable across restarts — regenerating it would silently
// untrust every certificate issued under the previous one.
export function loadOrCreateCA(): GeneratedCA {
  const { certPath, keyPath } = getCAPaths();

  if (existsSync(certPath) && existsSync(keyPath)) {
    try {
      const certPem = readFileSync(certPath, "utf8");
      const keyPem = readFileSync(keyPath, "utf8");
      new X509Certificate(certPem); // throws if corrupt
      return { certPem, keyPem };
    } catch {
      // Fall through and regenerate a fresh CA below.
    }
  }

  const ca = generateSelfSignedCA();
  mkdirSync(getCADir(), { recursive: true });
  writeFileSync(certPath, ca.certPem, { mode: 0o644 });
  writeFileSync(keyPath, ca.keyPem, { mode: 0o600 });
  return ca;
}

export interface CACertificateInfo {
  subject: string;
  validFrom: string;
  validTo: string;
  sha256Fingerprint: string;
}

export function getCACertificateInfo(): CACertificateInfo {
  const { certPem } = loadOrCreateCA();
  const x509 = new X509Certificate(certPem);
  return {
    subject: x509.subject,
    validFrom: x509.validFrom,
    validTo: x509.validTo,
    sha256Fingerprint: x509.fingerprint256,
  };
}

// Writes just the CA certificate (never the private key) to
// `destinationPath`, matching Burp's CA export. DER is written for a
// `.der`/`.cer` destination, PEM otherwise.
export function exportCACertificate(destinationPath: string): string {
  const { certPem } = loadOrCreateCA();
  if (/\.(der|cer)$/i.test(destinationPath)) {
    writeFileSync(destinationPath, pemToDer(certPem));
  } else {
    writeFileSync(destinationPath, certPem);
  }
  return destinationPath;
}
