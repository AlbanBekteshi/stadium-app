# Stadium — Cours collectifs (PWA mobile)

Application web mobile pour consulter l'horaire des cours collectifs Stadium et **réserver / annuler** en un tap.
Elle parle directement à l'API que le site officiel utilise lui-même (`webapi.stadium.be`) — aucun serveur intermédiaire.

## Contenu

```
index.html               toute l'app (HTML + CSS + JS, un seul fichier)
manifest.webmanifest     pour l'installation en app sur le téléphone
sw.js                    service worker (cache de l'interface, jamais des données)
icons/                   icônes 192 / 512 / maskable
test/shot.js             test visuel Playwright avec API simulée (optionnel)
```

## Publier sur GitHub Pages

### En ligne de commande

```bash
cd stadium-app
git init && git add . && git commit -m "Stadium PWA"
git branch -M main
git remote add origin git@github.com:<ton-user>/stadium-app.git
git push -u origin main
```

Puis sur GitHub : **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `/ (root)`** → Save.
L'app est en ligne ~1 min plus tard sur `https://<ton-user>.github.io/stadium-app/`.

### Sans ligne de commande

Créer un dépôt vide sur github.com → *Add file → Upload files* → glisser le contenu du dossier
(y compris le dossier `icons`) → commit → puis même réglage **Settings → Pages**.

> HTTPS est indispensable : le hachage du mot de passe (`crypto.subtle`) et le service worker
> ne fonctionnent pas en `http://` ni en `file://`. GitHub Pages fournit HTTPS d'office.

## Installer sur le téléphone

- **Android / Chrome** : ouvrir l'URL → menu ⋮ → *Ajouter à l'écran d'accueil*.
- **iPhone / Safari** : ouvrir l'URL → bouton Partager → *Sur l'écran d'accueil*.

L'app s'ouvre alors en plein écran, sans barre d'adresse.

## Sécurité

- Le mot de passe est haché en **SHA-256 dans le navigateur** avant l'envoi, exactement comme le fait le site officiel.
- **Le mot de passe n'est jamais stocké.** Seul le jeton de session renvoyé par Stadium est gardé dans le
  `localStorage` du téléphone (une entrée par club), plus l'identifiant pour préremplir le champ.
- Rien n'est envoyé ailleurs qu'à `webapi.stadium.be`. Pas d'analytics, pas de backend, pas de cookies tiers.
- La 2FA par SMS est prise en charge (écran de code si Stadium la demande).

## API utilisée (pour maintenance)

Base : `https://webapi.stadium.be/api/{club}` — club `1` = Stadium One, `4` = Coupure, `5` = Kinetix, `6` = Caméléon.
En-tête d'authentification : `authorization: <token>` (jeton brut, sans `Bearer`).

| Action | Appel |
|---|---|
| Connexion | `POST /api/Portal/Login` — FormData `identificatie`, `password` (SHA-256 hex) → `{Token}` ou `{Requires2FA, ChallengeId, MaskedMobile}` |
| 2FA | `POST /api/Portal/Verify2FA` — `{challengeId, code}` → `{Token}` |
| Horaire du jour | `GET /api/Lessenrooster/geplande_lessen?datum=JJ/MM/AAAA&LesId=` |
| Mes réservations | `GET /api/Portal/Booking` (les cours ont `Type === 0`, détails dans `LesUur`) |
| Réserver | `POST /api/Portal/Booking_Lesuur` — `{LesUurId, ComputerId:null}` → `{Type, Msg}` |
| Annuler | `POST /api/Portal/Annulation` — `{ReservatieId}` |

Détails utiles :

- `Remaining` = places restantes, `MaxReservaties` = capacité, `ReservatieId` présent = déjà réservé.
- Chaque cours porte les catégories officielles `Shape`, `FunMove`, `Sport`, `Power`, `Balance` et les options
  `Dertig` (30 min), `LadiesOnly`, `Outdoor`. Ce sont elles qui alimentent le panneau de filtres, avec `Niveau`
  (affiché en étoiles ☆ comme le planning officiel), `Zaal` (salle) et `leerkrachtnaam` (professeur).
  Salle et professeur sont recalculés sur le jour affiché ; une sélection absente du nouveau jour est retirée.
- Réponse de réservation `Type === 4` : Stadium demande une confirmation — l'app renvoie la même requête une fois
  (c'est ce que fait le site officiel).
- L'API renvoie `Access-Control-Allow-Origin` ouvert, donc l'app fonctionne depuis n'importe quel domaine.

## Auto-réservation (dossier `autobook/`)

Script Node sans dépendance qui se connecte, balaie les prochains jours et réserve les cours listés
dans `autobook/targets.json`. Idéal juste après l'ouverture des inscriptions.

1. Éditer `autobook/targets.json` :

```json
[{ "name": "Cycling High Intensity", "day": "mardi", "time": "18:30" },
 { "name": "Pilates Reformer", "teacher": "Laura" }]
```

`name` = correspondance partielle (accents et casse ignorés). `day`, `time`, `teacher` sont facultatifs :
sans eux, tous les cours de ce nom sur la période sont visés. `"enabled": false` désactive une ligne.

2. Tester en simulation, puis en réel :

```bash
STADIUM_USER=... STADIUM_PASSWORD=... node autobook/book.mjs --dry-run
STADIUM_USER=... STADIUM_PASSWORD=... node autobook/book.mjs
```

### Le planifier

**Sur ton PC (recommandé)** — copier `autobook/run-windows.example.cmd` en `autobook/run-windows.cmd`
(ce nom-là est dans `.gitignore`, tes identifiants ne partiront jamais dans git), y mettre tes identifiants,
tester avec `run-windows.cmd --dry-run`, puis Planificateur de tâches Windows → tâche répétée toutes les 15 min.
C'est l'option la plus fiable : l'API Stadium répond depuis une connexion belge normale.

**GitHub Actions** — `.github/workflows/autobook.yml` est prêt (cron toutes les 15 min).
Ajouter dans le dépôt : *Settings → Secrets and variables → Actions* → secrets `STADIUM_USER`
et `STADIUM_PASSWORD`, variable facultative `STADIUM_CLUB`. **À tester d'abord en `workflow_dispatch`
avec `dry_run`** : l'API refuse (403) une partie des IP de datacenter, et les runners GitHub sont aux
États-Unis. Si le job renvoie 403, garder la planification sur ton PC ou sur ton hébergement OVH.

> La 2FA SMS est incompatible avec l'auto-réservation : si le compte l'exige, le script s'arrête avec
> un message explicite.

## Limites connues

- API **non officielle et non documentée** : si Stadium la modifie, l'app peut casser (les endpoints ci-dessus
  suffisent alors à la réparer).
- Pas de liste d'attente : un cours complet est simplement affiché « Complet ».
- Pas d'achat d'abonnement, pas de réservation de terrain / fitness — uniquement les cours collectifs.

## Test local

```bash
npm install playwright
node test/shot.js     # captures d'écran dans test/, API simulée
```
