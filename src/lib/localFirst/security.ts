const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const fromBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};

export const createSalt = (): string => {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return toBase64(salt);
};

export const hashPin = async (pin: string, salt: string): Promise<string> => {
  const input = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return toBase64(new Uint8Array(digest));
};

export const verifyPin = async (pin: string, salt: string, expectedHash: string): Promise<boolean> => {
  const actualHash = await hashPin(pin, salt);
  const actual = fromBase64(actualHash);
  const expected = fromBase64(expectedHash);

  if (actual.length !== expected.length) return false;

  let difference = 0;
  actual.forEach((byte, index) => {
    difference |= byte ^ expected[index];
  });
  return difference === 0;
};
