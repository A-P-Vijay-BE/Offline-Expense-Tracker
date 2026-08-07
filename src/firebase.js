import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence
} from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "firebase/firestore";
import { firebaseConfig } from "./firebase-config.js";

export const isFirebaseConfigured =
  firebaseConfig.apiKey &&
  !firebaseConfig.apiKey.startsWith("PASTE_") &&
  firebaseConfig.projectId &&
  !firebaseConfig.projectId.startsWith("PASTE_");

export let firebaseApp = null;
export let auth = null;
export let firestore = null;

if (isFirebaseConfigured) {
  firebaseApp = initializeApp(firebaseConfig);

  auth = getAuth(firebaseApp);
  setPersistence(auth, browserLocalPersistence).catch((error) => {
    console.warn("Could not set local authentication persistence:", error);
  });

  firestore = initializeFirestore(firebaseApp, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
}
