const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function assertAddress(address: string): void {
  if (!ADDRESS_RE.test(address)) {
    throw new Error(`Invalid address key: ${address}`);
  }
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesKeyFromAddress(addressKey: string): Promise<CryptoKey> {
  assertAddress(addressKey);
  const addressBytes = hexToBytes(addressKey);
  const digest = await crypto.subtle.digest('SHA-256', addressBytes);
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptWithAddressKey(plaintext: string, addressKey: string): Promise<string> {
  const key = await deriveAesKeyFromAddress(addressKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const cipherBytes = new Uint8Array(cipherBuffer);

  return `sl1:${bytesToBase64(iv)}:${bytesToBase64(cipherBytes)}`;
}

export async function decryptWithAddressKey(payload: string, addressKey: string): Promise<string> {
  const [prefix, ivB64, cipherB64] = payload.split(':');
  if (prefix !== 'sl1' || !ivB64 || !cipherB64) {
    throw new Error('Unsupported ciphertext format');
  }

  const key = await deriveAesKeyFromAddress(addressKey);
  const iv = base64ToBytes(ivB64);
  const cipherBytes = base64ToBytes(cipherB64);
  const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBytes);
  return new TextDecoder().decode(plainBuffer);
}

