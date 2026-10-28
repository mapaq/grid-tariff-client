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
    const kind = h < 14 ? 'actual' : 'preview';
    if (shape === 'typed') pts.push({ componentId: 'c', priceType: kind, validPeriod: { fromIncluding: from, toExcluding: to }, price: price(ex) });
    else if (shape === 'grouped') pts.push({ kind, pt: { validPeriod: { fromIncluding: from, toExcluding: to }, price: price(ex) } });
    else if (shape === 'flat') pts.push({ fromIncluding: from, toExcluding: to, price: { priceExVat: ex, priceIncVat: ex * 1.25 } });
    else pts.push({ componentId: 'c', validPeriod: { fromIncluding: from, toExcluding: to }, price: price(ex) });
  }
  if (shape === 'grouped') return { actual: pts.filter(x => x.kind === 'actual').map(x => x.pt), preview: pts.filter(x => x.kind === 'preview').map(x => x.pt) };
  return shape === 'flat' ? pts : { prices: pts };
}

/* ---------- testkörning per läge ---------- */
const DAY = '2026-11-20';   // priser finns publicerade för en dag FÖRE tariffens start (2026-12-01)
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
        if (url === 'data/prod/prices/GN6KWST.json') return reply(200, pricesFor(DAY, pricesShape));
        return reply(404, { error: 'nope' });
      }
      if (url === 'data/manifest.json') return reply(404, { error: 'nope' });
      if (url === '/api/prod/tariffs') return reply(200, { tariffs, calendarPatterns });
      if (url === '/api/prod/info') return reply(200, info);
      if (url.startsWith('/api/prod/prices?')) {
        const q = new URLSearchParams(url.split('?')[1]);
        return reply(200, q.get('date') === DAY ? pricesFor(DAY, pricesShape) : { prices: [] });
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
  ok(!list.includes('class="group"') && count(list, /class="grid"/g) === 1, 'inga grupprubriker: ett enda rutnät');
  ok(cardOf(list, 'GNM63').includes('>Förbrukning</span>') && cardOf(list, 'GN6KW').includes('>Förbrukning</span>') && cardOf(list, 'GNSPAT').includes('>Inmatning</span>'), 'varje kort har en etikett för förbrukning/inmatning');
  ok(list.indexOf('>GNSPAT<') > list.indexOf('>GN6KWST<') && list.indexOf('>GNSPAT<') > list.indexOf('>GNM63<'), 'inmatning sorteras sist, även om den inte är sist på namn/status');
  const gnm = cardOf(list, 'GNM63');
  ok(nbsp(gnm).includes('2 460 kr/år') && gnm.includes('205 kr/mån'), 'fast avgift inkl moms: 2 460 kr/år (205 kr/mån)');
  ok(gnm.includes('23 öre/kWh') && gnm.includes('68 öre/kWh'), 'energi 23 öre + summa 68 öre/kWh');
  ok(gnm.includes('49 kr/kW/mån') && !gnm.includes('class="chart"'), 'platt effektavgift 49 kr/kW/mån utan diagram');
  // rådata för tariffobjektet (/tariffs) med tydlig källa
  const how = mode === 'snapshot' ? 'Snapshot hämtad' : 'Hämtad live via server.py';
  ok(gnm.includes('Rådata · tariffobjekt (från /tariffs)') && gnm.includes('GET https://api.goteborgenergi.cloud/gridtariff/v0/tariffs') && gnm.includes('tariffs[1]') && gnm.includes(how), 'tariffkortet har rådatavy med källa (endpoint, objektindex, ' + (mode === 'snapshot' ? 'snapshot' : 'live') + ')');
  ok(mode === 'live' || gnm.includes('data/prod/tariffs.json'), 'snapshot: anger filen data/prod/tariffs.json');
  ok(gnm.includes('&quot;product&quot;: &quot;GNM63&quot;') && gnm.includes('&quot;validPeriod&quot;'), 'rådatat är hela tariffobjektet som JSON');
  ok(count(list, /Rådata · tariffobjekt/g) === count(list, /<article/g), 'varje tariffkort har en rådatavy');
  const st = cardOf(list, 'GN6KWST');
  ok(st.includes('Kommande') && st.includes('avgifterna visas för 2026-12-01') && st.includes('Tariffen börjar gälla 2026-12-01'), 'timpris-tariff markeras Kommande, avgifter klampas till 2026-12-01 och timpriser visas för valt datum');
  let d0 = get('#dyn-0').innerHTML;
  ok(d0.includes('Inga timpriser för 2026-10-26') && (mode === 'live' || (d0.includes('Servern har priser för 2026-11-20') && d0.includes('data-goto="2026-11-20"'))), 'datum utan priser: tydligt meddelande' + (mode === 'snapshot' ? ' + hopp till dagen som har priser' : ''));
  if (mode === 'snapshot') {
    get('#list').onclick({ target: { closest: sel => sel === '[data-goto]' ? { dataset: { goto: '2026-11-20' } } : null } }); await sleep(200);
    ok(run('state.date') === DAY, 'hoppknappen går till första dagen med priser');
  } else { run(`setDate('${DAY}')`); await sleep(200); }
  d0 = get('#dyn-0').innerHTML;
  ok(count(d0, /class="bar /g) === 24 && d0.includes('Högst'), 'timpris-diagram visas för dag före tariffens start (24 staplar + statistik)');
  ok(cardOf(get('#list').innerHTML, 'GN6KWST').includes('Tariffen börjar gälla 2026-12-01') && cardOf(get('#list').innerHTML, 'GN6KWST').includes('gäller alltså inte än'), 'kortet säger tydligt att tariffen inte börjat gälla');
  const rawP = get('#dyn-0').innerHTML;
  ok(rawP.includes('Rådata · timpriser (från /prices)') && rawP.includes('GET https://api.goteborgenergi.cloud/gridtariff/v0/prices?product=GN6KWST' + (mode === 'live' ? '&amp;date=' + DAY : '')) && rawP.includes(how), 'timpris-rådatat anger källa (/prices-anrop' + (mode === 'live' ? ' med datum' : ', snapshot') + ')');
  ok(mode === 'live' || rawP.includes('data/prod/prices/GN6KWST.json'), 'snapshot: anger prisfilen');
  const wantUrl = mode === 'snapshot' ? 'data/prod/prices/GN6KWST.json' : `/api/prod/prices?product=GN6KWST&date=${DAY}`;
  ok(fetchLog.includes(wantUrl), `hämtar ${wantUrl}`);
  run(`setDate('2026-10-26')`); await sleep(100);
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

  run(`setDate('${DAY}')`); pricesShape = 'flat'; run(`priceCache.clear(); render()`); await sleep(200);
  ok(count(get('#dyn-0').innerHTML, /class="bar /g) === 24, 'tolkar även platt lista med punkter');
  run(`setDate('2026-11-25')`); await sleep(200);
  ok(get('#dyn-0').innerHTML.includes('Inga timpriser för 2026-11-25'), 'dag efter publicerade priser => tydligt meddelande');

  // actual (beslutat) vs preview (prognos)
  run(`setDate('${DAY}')`); pricesShape = 'nested'; run(`priceCache.clear(); render()`); await sleep(200);
  let d1 = get('#dyn-0').innerHTML;
  ok(!d1.includes('class="legend"') && d1.includes('anger inte om priserna är actual eller preview'), 'utan typ i svaret: ingen färgsättning, tydlig notis');
  for (const shape of ['typed', 'grouped']) {
    pricesShape = shape; run(`priceCache.clear(); setDate('${DAY}')`); await sleep(200);
    d1 = get('#dyn-0').innerHTML;
    ok(count(d1, /class="bar [^"]*\bactual\b/g) === 14 && count(d1, /class="bar [^"]*\bpreview\b/g) === 10, `${shape}: 14 timmar actual + 10 timmar preview`);
    ok(d1.includes('class="legend"') && d1.includes('Actual – faktiskt satt, beslutat pris') && d1.includes('Preview – prognos, kan ändras') && d1.includes('14 tim') && d1.includes('10 tim'), `${shape}: teckenruta med förklaring och antal timmar`);
    ok(d1.includes('Preview (prognos)') && d1.includes('Actual (beslutat pris)'), `${shape}: tooltip anger typ per timme`);
  }
  const card1 = cardOf(get('#list').innerHTML, 'GN6KWST');
  ok(card1.includes('data-step="-1"') && card1.includes('data-step="1"') && card1.includes(`data-from="${DAY}"`), 'timpriskortet har bläddringsknappar för föregående/nästa dag');
  get('#list').onclick({ target: { closest: sel => sel === '[data-step]' ? { dataset: { step: '1', from: DAY } } : null } }); await sleep(200);
  ok(run('state.date') === '2026-11-21', 'knappen "nästa dag" flyttar fram ett dygn');
  ctx.document.onkeydown({ key: 'ArrowLeft', target: { tagName: 'BODY' } }); await sleep(100);
  ok(run('state.date') === DAY, 'piltangent vänster går bakåt ett dygn');
  ctx.document.onkeydown({ key: 'ArrowRight', target: { tagName: 'INPUT' } });
  ok(run('state.date') === DAY, 'piltangenter ignoreras i inmatningsfält');

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
