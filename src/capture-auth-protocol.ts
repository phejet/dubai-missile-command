import { SHA256 } from "./capture-contract";

const ENROLLMENT_PREFIX = new TextEncoder().encode("DMC-ENROLL-v1\0");
const CAPTURE_PREFIX = new TextEncoder().encode("DMC-CAPTURE-v1\0");

function tokenBytes(token: string): Uint8Array {
  const bytes = new TextEncoder().encode(token);
  if (bytes.byteLength === 0 || bytes.byteLength > 4_096) throw new Error("invalid challenge token length");
  return bytes;
}

function u32be(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function hexBytes(value: string): Uint8Array {
  if (!SHA256.test(value)) throw new Error("invalid decoded-body SHA-256");
  return Uint8Array.from({ length: 32 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

export function enrollmentClientData(token: string): Uint8Array {
  const encoded = tokenBytes(token);
  return concatBytes(ENROLLMENT_PREFIX, u32be(encoded.byteLength), encoded);
}

export function captureClientData(token: string, decodedBodySha256: string): Uint8Array {
  const encoded = tokenBytes(token);
  return concatBytes(CAPTURE_PREFIX, u32be(encoded.byteLength), encoded, hexBytes(decodedBodySha256));
}
