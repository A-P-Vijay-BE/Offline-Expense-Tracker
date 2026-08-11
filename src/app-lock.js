import { getSetting, putSetting } from "./local-db.js";

const SETTING_KEY = "appLockEnabled";
const CREDENTIAL_KEY = "appLockCredentialId";

function bufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function isWebAuthnAvailable() {
  if (!window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function isAppLockEnabled() {
  const enabled = await getSetting(SETTING_KEY);
  return enabled === true;
}

export async function enableAppLock() {
  const available = await isWebAuthnAvailable();
  if (!available) throw new Error("Biometric authentication is not available on this device.");

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "My Expenses", id: location.hostname },
      user: {
        id: userId,
        name: "expense-user",
        displayName: "Expense Tracker User",
      },
      pubKeyCredParams: [
        { alg: -7, type: "public-key" },
        { alg: -257, type: "public-key" },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "discouraged",
      },
      timeout: 60000,
      attestation: "none",
    },
  });

  const credentialId = bufferToBase64(credential.rawId);
  await putSetting(CREDENTIAL_KEY, credentialId);
  await putSetting(SETTING_KEY, true);
  return true;
}

export async function disableAppLock() {
  await putSetting(SETTING_KEY, false);
  await putSetting(CREDENTIAL_KEY, null);
}

export async function verifyWithBiometrics() {
  const credentialId = await getSetting(CREDENTIAL_KEY);
  if (!credentialId) throw new Error("No biometric credential registered.");

  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [{
        id: base64ToBuffer(credentialId),
        type: "public-key",
        transports: ["internal"],
      }],
      userVerification: "required",
      timeout: 60000,
    },
  });

  return !!assertion;
}
