import { registerPlugin } from "@capacitor/core";

interface NativeAppAttestPlugin {
  isSupported(): Promise<{ supported: boolean }>;
  generateKey(): Promise<{ keyId: string }>;
  attestKey(options: { keyId: string; clientDataHash: string }): Promise<{ attestation: string }>;
  generateAssertion(options: { keyId: string; clientDataHash: string }): Promise<{ assertion: string }>;
}

export interface AppAttestClient {
  isSupported(): Promise<boolean>;
  generateKey(): Promise<string>;
  attestKey(keyId: string, clientDataHash: Uint8Array): Promise<string>;
  generateAssertion(keyId: string, clientDataHash: Uint8Array): Promise<string>;
}

const nativePlugin = registerPlugin<NativeAppAttestPlugin>("AppAttest");

function standardBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64UrlFromStandard(value: string): string {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export const appAttestClient: AppAttestClient = {
  async isSupported() {
    return (await nativePlugin.isSupported()).supported;
  },
  async generateKey() {
    return (await nativePlugin.generateKey()).keyId;
  },
  async attestKey(keyId, clientDataHash) {
    const result = await nativePlugin.attestKey({ keyId, clientDataHash: standardBase64(clientDataHash) });
    return base64UrlFromStandard(result.attestation);
  },
  async generateAssertion(keyId, clientDataHash) {
    const result = await nativePlugin.generateAssertion({ keyId, clientDataHash: standardBase64(clientDataHash) });
    return base64UrlFromStandard(result.assertion);
  },
};
