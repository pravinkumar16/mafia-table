"use client";
// Reconnect identity and saved wardrobe, kept in localStorage.

const SECRET_KEY = "mt:secret";
const PROFILE_KEY = "mt:profile";

export interface Profile {
  name: string;
  bodyColor: string;
  skinColor: string;
  mic: boolean;
  cam: boolean;
}

export const BODY_COLORS = ["#E0A458", "#D1495B", "#7FB685", "#6C8EBF", "#C38D9E", "#F2C14E", "#4F9D9A", "#B07BAC", "#EDEDE9", "#3D405B"];
export const SKIN_COLORS = ["#F7DCC7", "#F5D0B5", "#E8B48F", "#C68863", "#A86B48", "#8D5A3B", "#5C3A24", "#3B2417"];

const randomId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

export function getSecret(): string {
  try {
    let s = localStorage.getItem(SECRET_KEY);
    if (!s || !/^[A-Za-z0-9-]{16,64}$/.test(s)) {
      s = randomId();
      localStorage.setItem(SECRET_KEY, s);
    }
    return s;
  } catch {
    // Private mode etc: a per-tab secret still works, just without refresh-reconnect.
    return randomId();
  }
}

export function loadProfile(): Profile {
  const fallback: Profile = { name: "", bodyColor: BODY_COLORS[0], skinColor: SKIN_COLORS[2], mic: true, cam: true };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "{}") };
  } catch {
    return fallback;
  }
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {}
}

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export function randomRoomCode(): string {
  let out = "";
  const buf = new Uint32Array(5);
  crypto.getRandomValues(buf);
  for (const n of buf) out += LETTERS[n % LETTERS.length];
  return out;
}

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}
