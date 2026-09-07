// Test visuel hors-ligne : l'API Stadium est simulée (le conteneur cloud n'y a pas accès).
const { chromium } = require('playwright');
const path = require('path');

const sample = (dateStr) => ([
  { Id: 1001, Datum: dateStr, Dagnummer: 2, Beginuur: "09:00", Einduur: "10:00", LesNaam: "Pilates Reformer",
    LesId: 10664, Niveau: "*/**", Zaal: "Studio F", leerkrachtnaam: "Elton", Remaining: 1, MaxReservaties: 23, LadiesOnly: false },
  { Id: 1002, Datum: dateStr, Dagnummer: 2, Beginuur: "12:00", Einduur: "13:00", LesNaam: "Cross Training",
    LesId: 195, Niveau: "**", Zaal: "Studio A", leerkrachtnaam: "Abdellah", Remaining: 12, MaxReservaties: 25 },
  { Id: 1003, Datum: dateStr, Dagnummer: 2, Beginuur: "18:00", Einduur: "19:00", LesNaam: "Yin Yoga",
    LesId: 300, Niveau: "*", Zaal: "Studio D", leerkrachtnaam: "Nuriah W.", Remaining: 0, MaxReservaties: 20 },
  { Id: 1004, Datum: dateStr, Dagnummer: 2, Beginuur: "18:30", Einduur: "19:30", LesNaam: "Cycling High Intensity",
    LesId: 301, Niveau: "***", Zaal: "Cycling", leerkrachtnaam: "Jacques V.", Remaining: 4, MaxReservaties: 30,
    ReservatieId: 55501 },
  { Id: 1005, Datum: dateStr, Dagnummer: 2, Beginuur: "20:00", Einduur: "21:00", LesNaam: "Ladies Kick Fit",
    LesId: 302, Niveau: "**", Zaal: "Dojo", leerkrachtnaam: "Mouss", Remaining: 9, MaxReservaties: 20, LadiesOnly: true },
]);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-BE',
    colorScheme: process.env.SCHEME === 'light' ? 'light' : 'dark',
  });

  await ctx.route('**/webapi.stadium.be/**', (route) => {
    const url = route.request().url();
    if (url.includes('geplande_lessen')) {
      const d = /datum=([0-9/]+)/.exec(url)[1];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sample(d)) });
    }
    if (url.includes('/Portal/Booking') && route.request().method() === 'GET') {
      const t = new Date(); const p = n => String(n).padStart(2, '0');
      const ds = `${p(t.getDate())}/${p(t.getMonth() + 1)}/${t.getFullYear()}`;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
        { Type: 0, ReservatieId: 55501, LesUur: sample(ds)[3] },
      ]) });
    }
    if (url.includes('/Portal/Login')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Token: 'fake-token' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const file = 'file://' + path.resolve(__dirname, '..', 'index.html');
  await page.goto(file);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test/01-login.png' });

  // login simulé
  await page.fill('#i-user', 'demo@example.com');
  await page.fill('#i-pass', 'demo');
  await page.click('#btn-login');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test/02-horaire.png' });

  // filtre favoris
  await page.click('.star >> nth=0');
  await page.click('#f-fav');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test/03-favoris.png' });
  await page.click('#f-fav');

  // onglet mes réservations
  await page.click('[data-tab="mine"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test/04-reservations.png' });

  // thème clair
  await page.click('[data-tab="schedule"]');
  await page.waitForTimeout(400);
  await page.click('#btn-theme');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test/05-clair.png' });

  console.log(errors.length ? 'ERREURS:\n' + errors.join('\n') : 'Aucune erreur JS');
  await browser.close();
})();
