"use client";
import { useEffect, useState } from "react";
import supabase from "../lib/supabaseClient";

// Shared password gate for early sharing/demos. This is NOT real auth —
// anyone with the password sees the same data. Set your own value below,
// or wire real per-user auth via Supabase (NEXT_PUBLIC_SUPABASE_URL +
// NEXT_PUBLIC_SUPABASE_ANON_KEY) and this gate steps aside automatically.
const ACCESS_PASSWORD = "aero2026";
const UNLOCK_KEY = "aero_unlocked";

const AMBER = "#f5a623";
const SIGNAL = "#ff5a3c";
const SLATE = "#0b0f16";
const PANEL = "#141b26";
const PANEL2 = "#1a2330";
const LINE = "#232f3e";
const MUTE = "#6b7c93";
const GREEN = "#3ddc84";

export default function AuthGate({ children }) {
  const [loggedIn, setLoggedIn] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [loginError, setLoginError] = useState(false);
  const [magicEmail, setMagicEmail] = useState("");
  const [magicSent, setMagicSent] = useState(false);
  const [magicError, setMagicError] = useState(null);

  // Check once per app load: (1) an existing Supabase session, or (2) the
  // password was already entered in this browser before. Either one skips
  // the gate — this is the fix for "asks for the password again on every
  // page." Previously `loggedIn` only ever lived in React state, which is
  // wiped on every full navigation between / , /batch, and /map.
  useEffect(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage.getItem(UNLOCK_KEY) === "1") {
        setLoggedIn(true);
      }
    } catch {}

    if (!supabase) {
      setAuthChecked(true);
      return;
    }
    // Defensive: a misconfigured URL/key (e.g. malformed env var) can make
    // these calls reject or throw. Without a .catch()/try here, that's an
    // unhandled rejection that crashes the whole app for every page (this
    // component wraps everything via layout.jsx) instead of just falling
    // back to the password gate.
    try {
      supabase.auth.getSession()
        .then(({ data }) => { if (data?.session) setLoggedIn(true); })
        .catch(() => {})
        .finally(() => setAuthChecked(true));
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session) setLoggedIn(true);
      });
      return () => sub?.subscription?.unsubscribe();
    } catch {
      setAuthChecked(true);
    }
  }, []);

  function unlockWithPassword() {
    if (passwordInput === ACCESS_PASSWORD) {
      try { window.localStorage.setItem(UNLOCK_KEY, "1"); } catch {}
      setLoggedIn(true);
    } else {
      setLoginError(true);
    }
  }

  async function sendMagicLink() {
    if (!magicEmail || !supabase) return;
    setMagicError(null);
    const { error } = await supabase.auth.signInWithOtp({ email: magicEmail });
    if (error) setMagicError(error.message);
    else setMagicSent(true);
  }

  if (!authChecked) return null;

  if (!loggedIn) {
    return (
      <div style={{ position: "fixed", inset: 0, background: SLATE, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, system-ui, sans-serif" }}>
        <div style={{ background: PANEL, padding: 40, borderRadius: 16, width: 340, textAlign: "center", border: `1px solid ${LINE}` }}>
          <div style={{ fontSize: 11, letterSpacing: 2, color: AMBER, fontFamily: "monospace" }}>AEROLEADAI</div>
          <h1 style={{ color: "#dfe6ee", fontSize: 20, margin: "6px 0 16px" }}>Property Intelligence</h1>

          {supabase ? (
            magicSent ? (
              <p style={{ color: GREEN, fontSize: 13 }}>Check your email for a sign-in link.</p>
            ) : (
              <>
                <input
                  type="email"
                  value={magicEmail}
                  onChange={(e) => setMagicEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendMagicLink()}
                  placeholder="you@company.com"
                  style={{ width: "100%", padding: 12, margin: "10px 0", background: PANEL2, border: `1px solid ${LINE}`, color: "#dfe6ee", borderRadius: 8, boxSizing: "border-box" }}
                />
                <button onClick={sendMagicLink} style={{ width: "100%", padding: 12, background: AMBER, color: "#1a1200", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>
                  Send sign-in link
                </button>
                {magicError && <p style={{ color: SIGNAL, fontSize: 12, marginTop: 10 }}>{magicError}</p>}
              </>
            )
          ) : (
            <>
              <p style={{ color: MUTE, fontSize: 13 }}>Enter access code</p>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && unlockWithPassword()}
                placeholder="Access code"
                style={{ width: "100%", padding: 12, margin: "10px 0", background: PANEL2, border: `1px solid ${LINE}`, color: "#dfe6ee", borderRadius: 8, boxSizing: "border-box" }}
              />
              <button onClick={unlockWithPassword} style={{ width: "100%", padding: 12, background: AMBER, color: "#1a1200", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>
                Enter
              </button>
              {loginError && <p style={{ color: SIGNAL, fontSize: 12, marginTop: 10 }}>Wrong code — try again.</p>}
              <p style={{ color: MUTE, fontSize: 11, marginTop: 14 }}>You'll only need to do this once per device.</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return children;
}
