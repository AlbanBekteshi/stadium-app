#!/usr/bin/env node
/**
 * Auto-réservation des cours collectifs Stadium.
 * Node 18+ requis (fetch et FormData natifs). Aucune dépendance.
 *
 * Variables d'environnement :
 *   STADIUM_USER       e-mail ou numéro de membre
 *   STADIUM_PASSWORD   mot de passe (haché en SHA-256 avant l'envoi, jamais transmis en clair)
 *   STADIUM_CLUB       1 = Stadium One (défaut), 4 = Coupure, 5 = Kinetix, 6 = Caméléon
 *   STADIUM_TARGETS    chemin du fichier de cibles (défaut : ./targets.json à côté de ce script)
 *   STADIUM_DAYS       nombre de jours à balayer à partir d'aujourd'hui (défaut 8)
 *
 * Options :
 *   --dry-run   n'effectue aucune réservation, affiche seulement ce qui serait réservé
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes("--dry-run");

const CLUB = process.env.STADIUM_CLUB || "1";
const BASE = process.env.STADIUM_API_BASE || `https://webapi.stadium.be/api/${CLUB}`;
const DAYS = Number(process.env.STADIUM_DAYS || 8);
const TARGETS_FILE = process.env.STADIUM_TARGETS || join(HERE, "targets.json");

const DAY_NAMES = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

const log = (...a) => console.log(new Date().toISOString().slice(11, 16), ...a);
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const pad = (n) => String(n).padStart(2, "0");
const fmtApi = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

let TOKEN = null;

async function call(path, { method = "GET", json, form } = {}) {
  const headers = {};
  if (TOKEN) headers.authorization = TOKEN;
  if (json) headers["Content-Type"] = "application/json";

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: form ?? (json ? JSON.stringify(json) : undefined),
  });

  if (res.status === 403) {
    throw new Error(
      "403 refusé par Stadium. L'API bloque souvent les IP de datacenter : " +
      "lance ce script depuis une connexion belge (ton PC, un Raspberry Pi, ton hébergement OVH) " +
      "plutôt que depuis un runner GitHub."
    );
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${path} — ${text.slice(0, 200)}`);
  try { return text ? JSON.parse(text) : null; }
  catch { throw new Error(`Réponse non-JSON sur ${path} : ${text.slice(0, 200)}`); }
}

async function login() {
  const user = process.env.STADIUM_USER;
  const pass = process.env.STADIUM_PASSWORD;
  if (!user || !pass) throw new Error("STADIUM_USER et STADIUM_PASSWORD sont requis.");

  const form = new FormData();
  form.append("identificatie", user);
  form.append("password", sha256(pass));

  const res = await call("/api/Portal/Login", { method: "POST", form });

  if (res?.RetryAfterSeconds > 0)
    throw new Error(`Compte temporairement bloqué, réessai dans ${Math.ceil(res.RetryAfterSeconds / 60)} min.`);
  if (res?.Requires2FA)
    throw new Error("Ce compte demande une vérification 2FA par SMS : l'auto-réservation ne peut pas fonctionner sans intervention manuelle.");
  if (!res?.Token)
    throw new Error(res?.Msg || res?.msg || "Identifiants refusés.");

  TOKEN = res.Token;
  log("Connecté au club", CLUB);
}

/** Une cible correspond-elle à un cours de l'horaire ? */
function matches(target, cls, date) {
  if (target.name && !norm(cls.LesNaam).includes(norm(target.name))) return false;
  if (target.time && String(cls.Beginuur).slice(0, 5) !== String(target.time).slice(0, 5)) return false;
  if (target.day && norm(DAY_NAMES[date.getDay()]) !== norm(target.day)) return false;
  if (target.teacher && !norm(cls.leerkrachtnaam).includes(norm(target.teacher))) return false;
  return true;
}

async function bookOne(cls) {
  let res = await call("/api/Portal/Booking_Lesuur", {
    method: "POST",
    json: { LesUurId: cls.Id, ComputerId: null },
  });
  // Type 4 : Stadium demande une confirmation, on renvoie la même requête (comme le site officiel).
  if (res?.Type === 4) {
    res = await call("/api/Portal/Booking_Lesuur", {
      method: "POST",
      json: { LesUurId: cls.Id, ComputerId: null },
    });
  }
  return res;
}

async function main() {
  let targets;
  try {
    targets = JSON.parse(await readFile(TARGETS_FILE, "utf8"));
  } catch (e) {
    throw new Error(`Impossible de lire les cibles (${TARGETS_FILE}) : ${e.message}`);
  }
  targets = targets.filter(t => t && t.enabled !== false);
  if (!targets.length) { log("Aucune cible active, rien à faire."); return; }
  log(`${targets.length} cible(s), balayage sur ${DAYS} jours`);

  await login();

  const today = new Date(); today.setHours(0, 0, 0, 0);
  let booked = 0, waiting = 0;

  for (let i = 0; i < DAYS; i++) {
    const date = new Date(today); date.setDate(date.getDate() + i);
    let schedule;
    try { schedule = await call(`/api/Lessenrooster/geplande_lessen?datum=${fmtApi(date)}&LesId=`); }
    catch (e) { log(`  ! ${fmtApi(date)} : ${e.message}`); continue; }
    if (!Array.isArray(schedule) || !schedule.length) continue;

    for (const target of targets) {
      for (const cls of schedule) {
        if (!matches(target, cls, date)) continue;

        const label = `${fmtApi(date)} ${cls.Beginuur} ${cls.LesNaam}`;
        if (cls.ReservatieId) { log(`  = ${label} — déjà réservé`); continue; }
        if (cls.Remaining === 0) { log(`  x ${label} — complet`); waiting++; continue; }
        if (DRY) { log(`  → ${label} — serait réservé (${cls.Remaining} places)`); booked++; continue; }

        try {
          const res = await bookOne(cls);
          const msg = (res?.Msg || "").trim();
          if (res?.Type === 0 || /ok|réserv|reserv|gereserveerd/i.test(msg)) {
            log(`  ✓ ${label} — réservé${msg ? ` (${msg})` : ""}`);
            booked++;
          } else {
            log(`  ? ${label} — réponse : ${msg || JSON.stringify(res)}`);
          }
        } catch (e) {
          log(`  ! ${label} — ${e.message}`);
        }
      }
    }
  }

  log(`Terminé : ${booked} réservation(s)${DRY ? " (simulation)" : ""}${waiting ? `, ${waiting} cours complet(s)` : ""}`);
}

main().catch((e) => { console.error("ERREUR :", e.message); process.exit(1); });
