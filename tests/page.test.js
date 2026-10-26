// Kör index.html:s script i en Node-vm med en minimal DOM-stub och fixtures som speglar riktiga Prod-svar.
// Körs i två lägen: "snapshot" (data/*.json från GitHub Actions) och "live" (/api/... via server.py).
//   node tests/page.test.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

/* ---------- fixtures ---------- */
const vp = (f, t) => ({ fromIncluding: f, toExcluding: t });
const price = ex => ({ priceExVat: ex, priceIncVat: +(ex * 1.25).toFixed(5), currency: 'SEK' });
const Y26 = vp('2026-01-01', '2027-01-01');
const energy = (name, ex, p = Y26) => ({ name, type: 'fixed', reference: 'main', validPeriod: p, price: price(ex), unit: 'kWh' });
const fixedFee = (ex, p = Y26) => ({ name: 'Fast avgift', type: 'public', reference: 'main', validPeriod: p, price: price(ex), pricedPeriod: 'P1Y' });
const allDay = [{ reference: 'main', frequency: 'P1D', activePeriods: [{ fromIncluding: '00:00:00', toExcluding: '00:00:00', calendarPatternReferences: { include: ['weekdays', 'weekends'], exclude: [] } }] }];
const peak = (name, ex, p, rps, n = 3) => ({ name, type: 'peak', reference: 'x', validPeriod: p, price: price(ex), unit: 'kW', url: null,
  peakIdentificationSettings: { numberOfPeaksForAverageCalculation: n }, recurringPeriods: rps });
const hi = [{ reference: 'main', frequency: 'P1D', activePeriods: [{ fromIncluding: '07:00:00', toExcluding: '20:00:00', calendarPatternReferences: { include: ['weekdays'], exclude: ['holidays'] } }] }];
const lo = [{ reference: 'main', frequency: 'P1D', activePeriods: [
  { fromIncluding: '00:00:00', toExcluding: '07:00:00', calendarPatternReferences: { include: ['weekdays'], exclude: ['holidays'] } },
  { fromIncluding: '20:00:00', toExcluding: '00:00:00', calendarPatternReferences: { include: ['weekdays'], exclude: ['holidays'] } },
  { fromIncluding: '00:00:00', toExcluding: '00:00:00', calendarPatternReferences: { include: ['weekends', 'holidays'], exclude: [] } }] }];
const base = (name, product, p, extra) => ({ id: product + p.fromIncluding, name, description: null, published: '2025-12-03T12:00:00+01:00', validPeriod: p,
  timeZone: 'Europe/Stockholm', product, direction: 'consumption', billingPeriod: 'P1M', ...extra });
const empty = { id: '0', name: null, components: [] };

const tariffs = [
  base('Småhus och företag, Max 63A', 'GNM63', vp('2025-01-01', '2026-01-01'), { fixedPrice: { components: [fixedFee(1776, vp('2025-01-01', '2026-01-01'))] }, energyPrice: { components: [] }, powerPrice: { components: [] } }),
  base('Småhus och företag, Max 63A', 'GNM63', Y26, {
    fixedPrice: { components: [fixedFee(1968)] },
    energyPrice: { components: [energy('Elöverföringsavgift', 0.184), energy('Energiskatt', 0.36)] },
    powerPrice: { components: [peak('Effektavgift', 39.2, Y26, allDay)] } }),
  base('Tidsindelad 6 kW, Max 63A', 'GN6KW', Y26, {
    fixedPrice: { components: [fixedFee(1920)] },
    energyPrice: { components: [energy('Elöverföringsavgift', 0.052), energy('Energiskatt', 0.36)] },
    powerPrice: { components: [
      peak('Tidsindelad, effektavgift hög', 108, vp('2026-01-01', '2026-04-01'), hi),
      peak('Tidsindelad, effektavgift låg', 0, vp('2026-01-01', '2026-04-01'), lo),
      peak('Tidsindelad, effektavgift låg', 0, vp('2026-04-01', '2026-11-01'), allDay),
      peak('Tidsindelad, effektavgift hög', 108, vp('2026-11-01', '2027-01-01'), hi),
      peak('Tidsindelad, effektavgift låg', 0, vp('2026-11-01', '2027-01-01'), lo)] } }),
  base('Småhus timpris 6 kW', 'GN6KWST', vp('2026-12-01', '2028-01-01'), { billingPeriod: null,
    fixedPrice: { components: [fixedFee(1853, vp('2026-12-01', '2028-01-01'))] },
    energyPrice: { components: [energy('Elöverföringsavgift', 0.048, vp('2026-12-01', '2028-01-01'))] },
    powerPrice: { components: [{ name: 'Timpris, effektavgift', type: 'dynamic', reference: 'hourly', validPeriod: vp('2026-12-01', '2028-01-01'), price: null, unit: 'kW', url: '/prices?product=GN6KWST', recurringPeriods: null }] } }),
  base('Inmatning Småskalig timpris, Avgift', 'GNSPAT', vp('2026-12-01', '2028-01-01'), { direction: 'production', billingPeriod: null,
    fixedPrice: { components: [{ name: 'Mätavgift', type: 'public', validPeriod: vp('2026-12-01', '2028-01-01'), price: price(743), pricedPeriod: 'P1Y' }] },
    energyPrice: empty, powerPrice: empty }),
];
const calendarPatterns = [
  { reference: 'weekdays', frequency: 'P1W', days: [1, 2, 3, 4, 5], dates: [] },
  { reference: 'weekends', frequency: 'P1W', days: [6, 7], dates: [] },
  { reference: 'holidays', frequency: 'P1Y', days: [], dates: ['2026-12-24', '2026-12-25', '2027-01-01'] }];
const info = { name: 'Grid Tariff API', apiVersion: '0.3.2', implementationVersion: '0.5.1', tariffDataLastUpdated: '2026-10-19T16:08:31+00:00', operator: 'Göteborg Energi Nät AB', timeZone: 'Europe/Stockholm' };
const manifest = { generatedAt: '2026-10-26T16:00:00+00:00', envs: {
  prod: { ok: true, fetchedAt: '2026-10-26T16:00:00+00:00' },
  uat: { ok: false, fetchedAt: '2026-10-26T16:00:00+00:00', error: 'HTTP 503 från uat' } } };

// /prices-fixture: gissat format (timvisa punkter med validPeriod + price) – tolkningen är tolerant
function pricesFor(date, shape) {
  const pts = [];
  for (let h = 0; h < 24; h++) {
    const from = `${date}T${String(h).padStart(2, '0')}:00:00+01:00`;
    const to = h === 23 ? `${date}T23:59:59+01:00` : `${date}T${String(h + 1).padStart(2, '0')}:00:00+01:00`;
    const ex = 0.1 + (h >= 17 && h <= 20 ? 0.5 : 0) + h * 0.001;
    if (shape === 'flat') pts.push({ fromIncluding: from, toExcluding: to, price: { priceExVat: ex, priceIncVat: ex * 1.25 } });
    else pts.push({ componentId: 'c', validPeriod: { fromIncluding: from, toExcluding: to }, price: price(ex) });
  }
  return shape === 'flat' ? pts : { prices: pts };
}

/* ---------- testkörning per läge ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const count = (s, re) => (s.match(re) || []).length;
const cardOf = (listHtml, product) => listHtml.split('<article').find(c => c.includes(`>${product}<`)) || '';
const nbsp = s => s.replace(/ /g, ' ');   // sv-SE använder hårt mellanslag som tusentalsavgränsare
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  PASS ' : '  FAIL ') + msg); if (!cond) fails++; };

async function suite(mode) {
  console.log(`\n== läge: ${mode} ==`);
  const els = {}, fetchLog = [];
  const el = () => ({ innerHTML: '', className: '', value: '', style: {}, isConnected: true, dataset: {}, setAttribute() {} });
  const get = k => els[k] || (els[k] = el());
  let pricesShape = 'nested';
  const reply = (status, obj) => ({ ok: status < 400, status, text: async () => JSON.stringify(obj), json: async () => obj });
  const ctx = vm.createContext({
    console, URL, URLSearchParams, Intl, Date, Math, JSON, Object, Array, String, Number, Promise, setTimeout, clearTimeout, isNaN,
    document: { body: { className: '' }, querySelector: s => get(s), querySelectorAll: () => [], getElementById: id => get('#' + id) },
    localStorage: { getItem: () => null, setItem() {} },
    location: { protocol: 'http:', search: '' },
    fetch: async url => {
      fetchLog.push(url);
      if (mode === 'snapshot') {
        if (url === 'data/manifest.json') return reply(200, manifest);
        if (url === 'data/prod/tariffs.json') return reply(200, { tariffs, calendarPatterns });
        if (url === 'data/prod/info.json') return reply(200, info);
        if (url === 'data/prod/prices/GN6KWST.json') return reply(200, pricesFor('2026-12-01', pricesShape));
        return reply(404, { error: 'nope' });
      }
      if (url === 'data/manifest.json') return reply(404, { error: 'nope' });
      if (url === '/api/prod/tariffs') return reply(200, { tariffs, calendarPatterns });
      if (url === '/api/prod/info') return reply(200, info);
      if (url.startsWith('/api/prod/prices?')) {
        const q = new URLSearchParams(url.split('?')[1]);
        return reply(200, q.get('date') === '2026-12-01' ? pricesFor('2026-12-01', pricesShape) : { prices: [] });
      }
      return reply(404, { error: 'nope' });
    },
  });
  const run = code => vm.runInContext(code, ctx);
  vm.runInContext(script, ctx); await sleep(200);
  run(`setDate('2026-10-26')`); await sleep(200);

  let list = get('#list').innerHTML;
  ok(run('SOURCE') === mode, `datakälla identifierad som ${mode}`);
  ok(!list.includes('1 776'), 'utgången 2025-tariff döljs i standardfiltret');
  ok(list.includes('Förbrukning (uttag)') && list.includes('Inmatning (produktion)'), 'grupperar förbrukning/inmatning');
  const gnm = cardOf(list, 'GNM63');
  ok(nbsp(gnm).includes('2 460 kr/år') && gnm.includes('205 kr/mån'), 'fast avgift inkl moms: 2 460 kr/år (205 kr/mån)');
  ok(gnm.includes('23 öre/kWh') && gnm.includes('68 öre/kWh'), 'energi 23 öre + summa 68 öre/kWh');
  ok(gnm.includes('49 kr/kW/mån') && !gnm.includes('class="chart"'), 'platt effektavgift 49 kr/kW/mån utan diagram');
  const st = cardOf(list, 'GN6KWST');
  ok(st.includes('Kommande') && st.includes('visar priser för 2026-12-01'), 'timpris-tariff markeras Kommande och klampas till 2026-12-01');
  const d0 = get('#dyn-0').innerHTML;
  ok(count(d0, /class="bar /g) === 24 && d0.includes('Högst'), 'timpris-diagram med 24 staplar + statistik');
  const wantUrl = mode === 'snapshot' ? 'data/prod/prices/GN6KWST.json' : '/api/prod/prices?product=GN6KWST&date=2026-12-01';
  ok(fetchLog.includes(wantUrl), `hämtar ${wantUrl}`);
  ok(get('#info').innerHTML.includes(mode === 'snapshot' ? 'Snapshot hämtad' : 'Live via server.py'), 'inforaden visar datakälla');
  let g6 = cardOf(list, 'GN6KW');
  ok(!g6.includes('class="chart"') && g6.includes('0 kr/kW/mån'), 'sommar (okt): enbart "låg" 0 kr/kW, inget diagram');

  run(`setDate('2026-01-15')`); await sleep(100);
  g6 = cardOf(get('#list').innerHTML, 'GN6KW');
  ok(count(g6, /--h:100%/g) === 13, 'torsdag jan: 13 högprisstaplar (07–20)');
  ok(g6.includes('135 kr/kW/mån'), 'högpris 135 kr/kW/mån inkl moms');
  run(`setDate('2026-01-17')`); await sleep(100);
  g6 = cardOf(get('#list').innerHTML, 'GN6KW');
  ok(count(g6, /--h:100%/g) === 0 && count(g6, /class="bar zero/g) >= 24, 'lördag: allt lågpris (0)');
  run(`setDate('2026-12-24')`); await sleep(100);
  g6 = cardOf(get('#list').innerHTML, 'GN6KW');
  ok(g6.includes('helgdag') && count(g6, /--h:100%/g) === 0, '24 dec (helgdag, torsdag): lågpris hela dygnet');

  run(`state.vat='ex'; setDate('2026-10-26')`); await sleep(100);
  ok(nbsp(cardOf(get('#list').innerHTML, 'GNM63')).includes('1 968 kr/år'), 'exkl moms: 1 968 kr/år');
  run(`state.vat='inc'`);

  pricesShape = 'flat'; run(`priceCache.clear(); render()`); await sleep(200);
  ok(count(get('#dyn-0').innerHTML, /class="bar /g) === 24, 'tolkar även platt lista med punkter');
  run(`setDate('2026-12-05')`); await sleep(200);
  ok(get('#dyn-0').innerHTML.includes('Inga timpriser publicerade'), 'datum utan priser => tydligt meddelande');

  if (mode === 'snapshot') {
    run(`state.env='uat'; load()`); await sleep(200);
    ok(get('#list').innerHTML.includes('misslyckades') && get('#list').innerHTML.includes('HTTP 503 från uat'), 'miljö med misslyckad hämtning visar felet');
  }
}

(async () => {
  await suite('snapshot');
  await suite('live');
  console.log(fails ? `\n${fails} FAIL` : '\nAlla tester gick igenom');
  process.exit(fails ? 1 : 0);
})();
