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
  sendPasswordResetEmail,
  signInWithCustomToken,
  onAuthStateChanged,
  updateProfile,
  deleteUser,
  signOut,
} from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";
import { getFirebaseApp, siteWindowName } from "./db.js";

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

function emailDocId(email) {
  return String(email || "")
    .trim()
    .toLowerCase()
    .replace(/\//g, "_");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function adminSlugs() {
  const raw = import.meta.env.VITE_ADMIN_USERNAMES || "";
  return String(raw + ",Miguel_NP_10")
    .split(",")
    .map((s) => slugFromUsername(s))
    .filter(Boolean);
}

export function isAdminAccount(profile, username) {
  if (profile && profile.role === "admin") return true;
  const slug = slugFromUsername(username || (profile && profile.username) || "");
  return !!slug && adminSlugs().includes(slug);
}

export function isAdminEntry() {
  const path = (location.pathname || "/").replace(/\/+$/, "") || "/";
  if (path === "/admin" || path.endsWith("/admin.html")) return true;
  return new URLSearchParams(location.search).has("admin");
}

function digitsPhone(raw) {
  return String(raw || "").replace(/\D/g, "");
}

function firebaseErrorEs(err) {
  const code = err && err.code;
  if (code === "auth/email-already-in-use") return "Ese correo o usuario ya existe. Prueba otro o inicia sesión.";
  if (code === "auth/invalid-email") return "Escribe un correo válido.";
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

async function enrollPasskey(firestore, uid, username) {
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
        residentKey: "preferred",
        userVerification: "required",
      },
      timeout: 60000,
    },
  });
  if (!cred) throw new Error("No se pudo guardar la huella.");
  const credId = bufToB64url(cred.rawId);
  localStorage.setItem(PASSKEY_ID_KEY, credId);
  localStorage.setItem(PASSKEY_UID_KEY, uid);
  if (firestore) {
    await setDoc(doc(firestore, "passkeys", credId), { uid, username, createdAt: Date.now() });
    await setDoc(doc(firestore, "users", uid), { passkeyCredId: credId }, { merge: true });
  }
}

async function assertPasskey() {
  const rawId = localStorage.getItem(PASSKEY_ID_KEY);
  const publicKey = {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rpId: location.hostname,
    userVerification: "required",
    timeout: 60000,
  };
  if (rawId) {
    publicKey.allowCredentials = [{ type: "public-key", id: b64urlToBuf(rawId), transports: ["internal"] }];
  }
  const cred = await navigator.credentials.get({ publicKey });
  if (!cred) throw new Error("No se reconoció la huella.");
  return bufToB64url(cred.rawId);
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

export async function signOutSession() {
  sessionStorage.removeItem(UNLOCK_KEY);
  const app = getFirebaseApp();
  if (app) {
    try {
      await signOut(getAuth(app));
    } catch { /* ignore */ }
  }
  location.reload();
}

export function runAuthGate() {
  return new Promise((resolve) => {
    try { window.name = siteWindowName(); } catch { /* ignore */ }
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

    async function resolveAuthEmail(input) {
      const trimmed = String(input || "").trim();
      if (isValidEmail(trimmed)) return trimmed.toLowerCase();
      const slug = slugFromUsername(trimmed);
      if (!slug) return "";
      const uname = await getDoc(doc(firestore, "usernames", slug));
      if (uname.exists()) {
        const data = uname.data() || {};
        if (data.email) return String(data.email).toLowerCase();
        if (data.uid) {
          const profile = await getDoc(doc(firestore, "users", data.uid));
          if (profile.exists() && profile.data().email) return String(profile.data().email).toLowerCase();
        }
      }
      return emailFromUsername(trimmed);
    }

    async function afterSignedIn(user, { justRegistered, adminAttempt } = {}) {
      const profile = await loadProfile(user);
      const adminOk = isAdminAccount(profile, profile.username || user.displayName);
      if (adminAttempt && !adminOk) {
        setAuthError("Esta cuenta no es de administrador. Entra en el sitio de jugadores.");
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
      if (!adminOk && profile.registrationComplete === false) {
        if (justRegistered) {
          document.getElementById("authWaDone").disabled = true;
          showStep("whatsapp");
          return { user, profile, wait: true };
        }
        await abortIncompleteRegistration(user, profile);
        return { user, profile, wait: true };
      }

      await finish(user, sessionProfile || profile);
      return { user, profile: sessionProfile || profile, wait: false };
    }

    async function abortIncompleteRegistration(user, profile) {
      const slug = slugFromUsername((profile && profile.username) || (user && user.displayName) || "");
      const email = profile && profile.email;
      const credId = (profile && profile.passkeyCredId) || localStorage.getItem(PASSKEY_ID_KEY);
      try {
        if (slug) await deleteDoc(doc(firestore, "usernames", slug));
      } catch { /* ignore */ }
      try {
        if (email) await deleteDoc(doc(firestore, "emails", emailDocId(email)));
      } catch { /* ignore */ }
      try {
        if (credId) await deleteDoc(doc(firestore, "passkeys", credId));
      } catch { /* ignore */ }
      try {
        if (user && user.uid) await deleteDoc(doc(firestore, "users", user.uid));
      } catch { /* ignore */ }
      try {
        localStorage.removeItem(PASSKEY_ID_KEY);
        localStorage.removeItem(PASSKEY_UID_KEY);
      } catch { /* ignore */ }
      try {
        if (user) await deleteUser(user);
      } catch {
        try { await signOut(auth); } catch { /* ignore */ }
      }
      sessionUser = null;
      sessionProfile = null;
      finishing = false;
      showStep("form");
      if (gate) gate.hidden = false;
      setAuthError("Para terminar el registro debes unirte al grupo de WhatsApp. Vuelve a crear la cuenta cuando lo hagas.");
    }

    let sessionUser = null;
    let sessionProfile = null;
    let initialAuthHandled = false;
    let authSubmitInFlight = false;
    onAuthStateChanged(auth, async (user) => {
      if (authSubmitInFlight) return;
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
      if (isAdminEntry() && !isAdminAccount(sessionProfile, sessionProfile.username || user.displayName)) {
        try { await signOut(auth); } catch { /* ignore */ }
        sessionUser = null;
        sessionProfile = null;
        finishing = false;
        showStep("form");
        if (gate) gate.hidden = false;
        setAuthMode("admin");
        setAuthError("");
        return;
      }
      if (!isAdminAccount(sessionProfile, sessionProfile.username || user.displayName) && sessionProfile.registrationComplete === false) {
        await abortIncompleteRegistration(user, sessionProfile);
        return;
      }
      await afterSignedIn(user, { justRegistered: false, adminAttempt: isAdminEntry() });
    });

    function authMode() {
      if (isAdminEntry()) return "admin";
      if (document.getElementById("authModeLogin").classList.contains("active")) return "login";
      return "register";
    }

    function setAuthMode(mode) {
      const reg = document.getElementById("authModeRegister");
      const log = document.getElementById("authModeLogin");
      if (reg) reg.classList.toggle("active", mode === "register");
      if (log) log.classList.toggle("active", mode === "login");
      const lead = document.getElementById("authLead") || document.querySelector("[data-auth-step='form'] .auth-lead");
      const title = document.getElementById("authTitle") || document.querySelector("[data-auth-step='form'] h2");
      if (mode === "admin") {
        if (title) title.textContent = "Administrador";
        if (lead) lead.textContent = "Solo ingreso. No hay registro aquí: entra con tu usuario de administrador.";
        const userInput = document.getElementById("authUsername");
        if (userInput) userInput.placeholder = "tu usuario de administrador";
      } else {
        if (title) title.textContent = "Bienvenido a Dorado";
        if (lead) lead.textContent = "Crea tu cuenta o inicia sesión. Así tus números y tu billetera quedan a tu nombre.";
      }
      setAuthError("");
      syncRegisterFields();
    }

    function syncRegisterFields() {
      const mode = authMode();
      const isRegister = mode === "register";
      const emailWrap = document.getElementById("authEmailWrap");
      if (emailWrap) emailWrap.hidden = !isRegister;
      document.getElementById("authPhoneWrap").hidden = !isRegister;
      const forgot = document.getElementById("authForgotWrap");
      if (forgot) forgot.hidden = mode !== "login";
      document.getElementById("authSubmit").textContent =
        mode === "admin" ? "Entrar como administrador" : isRegister ? "Crear cuenta" : "Entrar";
      canUseBiometrics().then((ok) => {
        document.getElementById("authUseBioWrap").hidden = !(ok && isRegister);
        const loginBio = document.getElementById("authBioLoginBtn");
        if (loginBio) loginBio.hidden = !(ok && mode === "login");
      });
    }

    document.getElementById("authModeRegister").addEventListener("click", () => setAuthMode("register"));
    document.getElementById("authModeLogin").addEventListener("click", () => setAuthMode("login"));

    document.getElementById("authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      setAuthError("");
      const username = document.getElementById("authUsername").value.trim();
      const password = document.getElementById("authPassword").value;
      const emailInput = (document.getElementById("authEmail") && document.getElementById("authEmail").value.trim()) || "";
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
      if (isRegister && !isValidEmail(emailInput)) {
        setAuthError("Escribe un correo válido. Ahí te llega el mensaje si olvidas la clave.");
        return;
      }
      if (isRegister && (phone.length < 10 || phone.length > 12)) {
        setAuthError("Escribe un número de celular válido (10 dígitos).");
        return;
      }

      try {
        authSubmitInFlight = true;
        await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
        if (isRegister) {
          if (isAdminAccount({}, username)) {
            setAuthError("Ese usuario está reservado. Entra como jugador con otro nombre, o usa el enlace de administrador.");
            return;
          }
          const email = emailInput.toLowerCase();
          const taken = await getDoc(doc(firestore, "usernames", slug));
          if (taken.exists()) {
            setAuthError("Ese nombre de usuario ya existe. Prueba otro o inicia sesión.");
            return;
          }
          const emailTaken = await getDoc(doc(firestore, "emails", emailDocId(email)));
          if (emailTaken.exists()) {
            setAuthError("Ese correo ya está en una cuenta. Inicia sesión o restablece la clave.");
            return;
          }
          initialAuthHandled = true;
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          await updateProfile(cred.user, { displayName: username.trim() });
          await setDoc(doc(firestore, "usernames", slug), { uid: cred.user.uid, email });
          await setDoc(doc(firestore, "emails", emailDocId(email)), { uid: cred.user.uid, slug });
          await setDoc(doc(firestore, "users", cred.user.uid), {
            username: username.trim(),
            email,
            phone,
            joinedWhatsapp: false,
            registrationComplete: false,
            createdAt: Date.now(),
          });
          sessionUser = cred.user;
          sessionProfile = { username: username.trim(), email, phone, joinedWhatsapp: false, registrationComplete: false };
          if (document.getElementById("authUseBio").checked) {
            try {
              await enrollPasskey(firestore, cred.user.uid, username.trim());
            } catch {
              setAuthError("Cuenta creada. No se pudo guardar la huella; puedes entrar con tu clave.");
            }
          }
          await afterSignedIn(cred.user, { justRegistered: true });
        } else {
          initialAuthHandled = true;
          const email = adminAttempt ? emailFromUsername(username) : await resolveAuthEmail(username);
          const cred = await signInWithEmailAndPassword(auth, email, password);
          sessionUser = cred.user;
          await afterSignedIn(cred.user, { justRegistered: false, adminAttempt });
        }
      } catch (err) {
        setAuthError(firebaseErrorEs(err));
      } finally {
        authSubmitInFlight = false;
      }
    });

    document.getElementById("authBioYes").addEventListener("click", async () => {
      setAuthError("");
      try {
        await enrollPasskey(firestore, sessionUser.uid, sessionProfile.username);
        if (!sessionProfile.joinedWhatsapp || sessionProfile.registrationComplete === false) showStep("whatsapp");
        else await finish(sessionUser, sessionProfile);
      } catch (err) {
        setAuthError(err.message || "No se pudo activar la huella. Puedes continuar sin ella.");
      }
    });
    document.getElementById("authBioSkip").addEventListener("click", async () => {
      if (!sessionProfile.joinedWhatsapp) showStep("whatsapp");
      else await finish(sessionUser, sessionProfile);
    });

    document.getElementById("authWaCancel").addEventListener("click", async () => {
      if (!sessionUser) {
        showStep("form");
        return;
      }
      await abortIncompleteRegistration(sessionUser, sessionProfile);
    });
    document.getElementById("authJoinWa").addEventListener("click", () => {
      window.open(WHATSAPP_GROUP_LINK, "_blank", "noopener");
      document.getElementById("authWaDone").disabled = false;
    });
    document.getElementById("authWaDone").addEventListener("click", async () => {
      if (!sessionUser) return;
      const next = { ...sessionProfile, joinedWhatsapp: true, registrationComplete: true };
      await setDoc(doc(firestore, "users", sessionUser.uid), next, { merge: true });
      sessionProfile = next;
      await finish(sessionUser, sessionProfile);
    });

    document.getElementById("authBioLoginBtn").addEventListener("click", async () => {
      setAuthError("");
      try {
        authSubmitInFlight = true;
        const credId = await assertPasskey();
        let uid = localStorage.getItem(PASSKEY_UID_KEY);
        if (!uid && credId) {
          const pk = await getDoc(doc(firestore, "passkeys", credId));
          if (pk.exists()) uid = pk.data().uid;
        }
        if (auth.currentUser && (!uid || auth.currentUser.uid === uid)) {
          sessionUser = auth.currentUser;
          await afterSignedIn(auth.currentUser, { justRegistered: false, adminAttempt: isAdminEntry() });
          return;
        }
        const res = await fetch("/api/passkey-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credId, uid }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.token) {
          setAuthError(data.error || "No se pudo entrar con huella. Usa tu usuario, clave o el correo para restablecer.");
          return;
        }
        await setPersistence(auth, browserLocalPersistence);
        initialAuthHandled = true;
        const cred = await signInWithCustomToken(auth, data.token);
        sessionUser = cred.user;
        await afterSignedIn(cred.user, { justRegistered: false, adminAttempt: isAdminEntry() });
      } catch (err) {
        setAuthError(err.message || "No se reconoció la huella. Entra con tu clave.");
      } finally {
        authSubmitInFlight = false;
      }
    });

    document.getElementById("authForgotBtn").addEventListener("click", () => {
      setAuthError("");
      const from = document.getElementById("authUsername");
      const to = document.getElementById("authResetUser");
      if (from && to && from.value) to.value = from.value.trim();
      showStep("reset");
    });
    document.getElementById("authResetBack").addEventListener("click", () => {
      setAuthError("");
      showStep("form");
      setAuthMode("login");
    });
    document.getElementById("authResetSend").addEventListener("click", async () => {
      setAuthError("");
      const input = document.getElementById("authResetUser").value.trim();
      if (!input) {
        setAuthError("Escribe tu correo o tu nombre de usuario.");
        return;
      }
      try {
        const email = await resolveAuthEmail(input);
        if (!isValidEmail(email) || email.endsWith("@dorado-rifas.app")) {
          const slug = slugFromUsername(input);
          const taken = await getDoc(doc(firestore, "usernames", slug));
          if (taken.exists()) {
            const uid = taken.data().uid;
            const profileSnap = uid ? await getDoc(doc(firestore, "users", uid)) : null;
            const profile = profileSnap && profileSnap.exists() ? profileSnap.data() : {};
            await setDoc(doc(firestore, "passwordResets", slug), {
              uid,
              username: profile.username || input,
              phone: profile.phone || "",
              status: "pending",
              createdAt: Date.now(),
            });
            const lead = document.querySelector("[data-auth-step='reset'] .auth-lead");
            if (lead) {
              lead.textContent =
                "Esa cuenta no tiene correo. Un administrador confirmará y te enviará una clave por WhatsApp.";
            }
            document.getElementById("authResetSend").hidden = true;
            document.getElementById("authResetUser").disabled = true;
            return;
          }
          setAuthError("No encontramos esa cuenta. Revisa el correo o el usuario.");
          return;
        }
        await sendPasswordResetEmail(auth, email, {
          url: location.origin + "/",
          handleCodeInApp: false,
        });
        const lead = document.querySelector("[data-auth-step='reset'] .auth-lead");
        if (lead) {
          lead.textContent =
            "Si ese correo está en una cuenta, te llega un mensaje para crear una clave nueva. Revisa bandeja y spam. Luego entra con “Ya tengo cuenta”.";
        }
        document.getElementById("authResetSend").hidden = true;
        document.getElementById("authResetUser").disabled = true;
      } catch (err) {
        setAuthError(firebaseErrorEs(err));
      }
    });

    if (isAdminEntry()) {
      document.body.classList.add("admin-entry");
      document.title = "Administrador · Dorado Rifas";
      const tabs = document.getElementById("authTabs");
      if (tabs) tabs.hidden = true;
      const goPlay = document.getElementById("authGoPlay");
      if (goPlay) goPlay.hidden = false;
      const goPlayLink = goPlay && goPlay.querySelector("a");
      if (goPlayLink) {
        goPlayLink.addEventListener("click", (ev) => {
          ev.preventDefault();
          window.open("/", "dorado-player");
        });
      }
      setAuthMode("admin");
    } else {
      syncRegisterFields();
    }
  });
}
