/**
 * Puerta de entrada: cuenta + WhatsApp.
 * Firebase Auth guarda la clave (no la escribimos nosotros).
 * El "correo" interno se arma con el nombre de usuario, para que
 * la persona no tenga que inventar un email.
 * La huella / Face ID usa WebAuthn del celular o el computador
 * (solo en HTTPS, como Vercel). WhatsApp no deja unir gente sola:
 * hay que abrir el link.
 */
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  updateProfile,
} from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import { getFirebaseApp } from "./db.js";

const PASSKEY_ID_KEY = "dorado.passkey.cred";
const PASSKEY_UID_KEY = "dorado.passkey.uid";
const UNLOCK_KEY = "dorado.session.unlock";

export const WHATSAPP_GROUP_LINK = "https://chat.whatsapp.com/B6ISmgPJ0gIGEum0uR0Mip";

export function slugFromUsername(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9._]/g, "");
}

function emailFromUsername(name) {
  return slugFromUsername(name) + "@dorado-rifas.app";
}

function adminSlugs() {
  const raw = import.meta.env.VITE_ADMIN_USERNAMES || "James_R";
  return String(raw)
    .split(",")
    .map((s) => slugFromUsername(s))
    .filter(Boolean);
}

export function isAdminAccount(profile, username) {
  if (profile && profile.role === "admin") return true;
  const slug = slugFromUsername(username || (profile && profile.username) || "");
  return !!slug && adminSlugs().includes(slug);
}

function digitsPhone(raw) {
  return String(raw || "").replace(/\D/g, "");
}

function firebaseErrorEs(err) {
  const code = err && err.code;
  if (code === "auth/email-already-in-use") return "Ese nombre de usuario ya existe. Prueba otro o inicia sesión.";
  if (code === "auth/weak-password") return "La clave debe tener al menos 6 caracteres.";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
    return "Nombre de usuario o clave incorrectos.";
  }
  if (code === "auth/operation-not-allowed" || code === "auth/configuration-not-found") {
    return "Falta activar Authentication en Firebase: Build → Authentication → Comenzar → Correo/contraseña → Activar. En Authorized domains agrega dorado-rifas.vercel.app";
  }
  if (code === "auth/too-many-requests") return "Demasiados intentos. Espera un momento.";
  return (err && err.message) || "No se pudo completar. Intenta de nuevo.";
}

function b64urlToBuf(id) {
  const pad = id.replace(/-/g, "+").replace(/_/g, "/");
  const str = atob(pad);
  const buf = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) buf[i] = str.charCodeAt(i);
  return buf.buffer;
}

function bufToB64url(buf) {
  const bytes = new Uint8Array(buf);
  let str = "";
  bytes.forEach((b) => {
    str += String.fromCharCode(b);
  });
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function canUseBiometrics() {
  try {
    if (!window.PublicKeyCredential) return false;
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== "function") return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

async function enrollPasskey(uid, username) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Dorado Rifas", id: location.hostname },
      user: {
        id: new TextEncoder().encode(uid),
        name: username,
        displayName: username,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
      },
      timeout: 60000,
    },
  });
  if (!cred) throw new Error("No se pudo guardar la huella.");
  localStorage.setItem(PASSKEY_ID_KEY, bufToB64url(cred.rawId));
  localStorage.setItem(PASSKEY_UID_KEY, uid);
}

function showStep(name) {
  document.querySelectorAll("[data-auth-step]").forEach((el) => {
    el.hidden = el.dataset.authStep !== name;
  });
}

function setAuthError(msg) {
  const el = document.getElementById("authError");
  if (!el) return;
  el.textContent = msg || "";
  el.hidden = !msg;
}

export function runAuthGate() {
  return new Promise((resolve) => {
    const app = getFirebaseApp();
    const gate = document.getElementById("authGate");
    if (!app) {
      if (gate) gate.hidden = true;
      resolve({ uid: null, username: "Invitado", phone: "", isAdmin: false });
      return;
    }

    const auth = getAuth(app);
    const firestore = getFirestore(app);
    let finishing = false;

    async function finish(user, profile) {
      if (finishing) return;
      finishing = true;
      sessionStorage.setItem(UNLOCK_KEY, "1");
      if (gate) gate.hidden = true;
      resolve({
        uid: user.uid,
        username: profile.username || user.displayName || "Jugador",
        phone: profile.phone || "",
        isAdmin: isAdminAccount(profile, profile.username || user.displayName),
      });
    }

    async function loadProfile(user) {
      const snap = await getDoc(doc(firestore, "users", user.uid));
      return snap.exists() ? snap.data() : { username: user.displayName || "", phone: "", joinedWhatsapp: false };
    }

    async function afterSignedIn(user, { justRegistered, adminAttempt } = {}) {
      const profile = await loadProfile(user);
      const adminOk = isAdminAccount(profile, profile.username || user.displayName);
      if (adminAttempt && !adminOk) {
        setAuthError("Esta cuenta no es de administrador. Entra con “Ya tengo cuenta” para jugar.");
        finishing = false;
        showStep("form");
        if (gate) gate.hidden = false;
        return { user, profile, wait: true };
      }
      if (adminOk && profile.role !== "admin") {
        const next = { ...profile, role: "admin" };
        await setDoc(doc(firestore, "users", user.uid), next, { merge: true });
        sessionProfile = next;
      } else {
        sessionProfile = profile;
      }
      const needWa = !adminOk && !profile.joinedWhatsapp;

      if (needWa) {
        document.getElementById("authWaDone").disabled = true;
        showStep("whatsapp");
        return { user, profile, wait: true };
      }
      await finish(user, sessionProfile || profile);
      return { user, profile: sessionProfile || profile, wait: false };
    }

    let sessionUser = null;
    let sessionProfile = null;

    let initialAuthHandled = false;
    onAuthStateChanged(auth, async (user) => {
      if (initialAuthHandled || finishing) return;
      initialAuthHandled = true;
      if (!user) {
        sessionUser = null;
        showStep("form");
        if (gate) gate.hidden = false;
        return;
      }
      sessionUser = user;
      sessionProfile = await loadProfile(user);
      await afterSignedIn(user, { justRegistered: false });
    });

    function authMode() {
      if (document.getElementById("authModeAdmin").classList.contains("active")) return "admin";
      if (document.getElementById("authModeLogin").classList.contains("active")) return "login";
      return "register";
    }

    function setAuthMode(mode) {
      document.getElementById("authModeRegister").classList.toggle("active", mode === "register");
      document.getElementById("authModeLogin").classList.toggle("active", mode === "login");
      document.getElementById("authModeAdmin").classList.toggle("active", mode === "admin");
      const lead = document.querySelector("[data-auth-step='form'] .auth-lead");
      const title = document.querySelector("[data-auth-step='form'] h2");
      if (mode === "admin") {
        if (title) title.textContent = "Entrar como administrador";
        if (lead) lead.textContent = "Usa tu usuario y clave. Los jugadores no ven estos paneles.";
      } else {
        if (title) title.textContent = "Entra para jugar";
        if (lead) lead.textContent = "Crea tu cuenta o inicia sesión. Así tus números y tu billetera quedan a tu nombre.";
      }
      setAuthError("");
      syncRegisterFields();
    }

    function syncRegisterFields() {
      const mode = authMode();
      const isRegister = mode === "register";
      document.getElementById("authPhoneWrap").hidden = !isRegister;
      document.getElementById("authSubmit").textContent =
        mode === "admin" ? "Entrar como administrador" : isRegister ? "Crear cuenta" : "Entrar";
      canUseBiometrics().then((ok) => {
        document.getElementById("authUseBioWrap").hidden = !(ok && isRegister);
      });
    }

    document.getElementById("authModeRegister").addEventListener("click", () => setAuthMode("register"));
    document.getElementById("authModeLogin").addEventListener("click", () => setAuthMode("login"));
    document.getElementById("authModeAdmin").addEventListener("click", () => setAuthMode("admin"));

    document.getElementById("authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      setAuthError("");
      const username = document.getElementById("authUsername").value.trim();
      const password = document.getElementById("authPassword").value;
      const phone = digitsPhone(document.getElementById("authPhone").value);
      const remember = document.getElementById("authRemember").checked;
      const mode = authMode();
      const isRegister = mode === "register";
      const adminAttempt = mode === "admin";
      const slug = slugFromUsername(username);

      if (slug.length < 3) {
        setAuthError("El nombre de usuario debe tener al menos 3 letras o números.");
        return;
      }
      if (password.length < 6) {
        setAuthError("La clave debe tener al menos 6 caracteres.");
        return;
      }
      if (adminAttempt && !isAdminAccount({}, username)) {
        setAuthError("Ese usuario no está en la lista de administrador.");
        return;
      }
      if (isRegister && (phone.length < 10 || phone.length > 12)) {
        setAuthError("Escribe un número de celular válido (10 dígitos).");
        return;
      }

      try {
        await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
        const email = emailFromUsername(username);
        if (isRegister) {
          const taken = await getDoc(doc(firestore, "usernames", slug));
          if (taken.exists()) {
            setAuthError("Ese nombre de usuario ya existe. Prueba otro o inicia sesión.");
            return;
          }
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          await updateProfile(cred.user, { displayName: username.trim() });
          await setDoc(doc(firestore, "usernames", slug), { uid: cred.user.uid });
          await setDoc(doc(firestore, "users", cred.user.uid), {
            username: username.trim(),
            phone,
            joinedWhatsapp: false,
            createdAt: Date.now(),
          });
          sessionUser = cred.user;
          sessionProfile = { username: username.trim(), phone, joinedWhatsapp: false };
          if (document.getElementById("authUseBio").checked) {
            try {
              await enrollPasskey(cred.user.uid, username.trim());
            } catch {
              setAuthError("Cuenta creada. No se pudo guardar la huella; puedes entrar con tu clave.");
            }
          }
          await afterSignedIn(cred.user, { justRegistered: true });
        } else {
          const cred = await signInWithEmailAndPassword(auth, email, password);
          sessionUser = cred.user;
          await afterSignedIn(cred.user, { justRegistered: false, adminAttempt });
        }
      } catch (err) {
        setAuthError(firebaseErrorEs(err));
      }
    });

    document.getElementById("authBioYes").addEventListener("click", async () => {
      setAuthError("");
      try {
        await enrollPasskey(sessionUser.uid, sessionProfile.username);
        if (!sessionProfile.joinedWhatsapp) showStep("whatsapp");
        else await finish(sessionUser, sessionProfile);
      } catch (err) {
        setAuthError(err.message || "No se pudo activar la huella. Puedes continuar sin ella.");
      }
    });
    document.getElementById("authBioSkip").addEventListener("click", async () => {
      if (!sessionProfile.joinedWhatsapp) showStep("whatsapp");
      else await finish(sessionUser, sessionProfile);
    });

    document.getElementById("authJoinWa").addEventListener("click", () => {
      window.open(WHATSAPP_GROUP_LINK, "_blank", "noopener");
      document.getElementById("authWaDone").disabled = false;
    });
    document.getElementById("authWaDone").addEventListener("click", async () => {
      if (!sessionUser) return;
      const next = { ...sessionProfile, joinedWhatsapp: true };
      await setDoc(doc(firestore, "users", sessionUser.uid), next, { merge: true });
      sessionProfile = next;
      await finish(sessionUser, sessionProfile);
    });

    syncRegisterFields();
  });
}
