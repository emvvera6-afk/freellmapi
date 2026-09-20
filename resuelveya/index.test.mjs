// Smoke test de la landing estática. Se ejecuta con `node --test "resuelveya/**/*.test.mjs"`
// desde la raíz del monorepo (jsdom ya está en los devDependencies de la raíz).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));

function loadPage() {
  const jsdomErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => jsdomErrors.push(e.message));

  const dom = new JSDOM(readFileSync(join(here, 'index.html'), 'utf8'), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://resuelveya.test/',
    virtualConsole,
    beforeParse(window) {
      window.Element.prototype.scrollIntoView = function () {};
      window.matchMedia = window.matchMedia || ((q) => ({
        matches: false,
        media: q,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
      }));
    },
  });

  const { window } = dom;
  return {
    window,
    doc: window.document,
    jsdomErrors,
    $: (s) => window.document.querySelector(s),
    $$: (s) => [...window.document.querySelectorAll(s)],
    fire: (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true })),
    click: (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })),
    cards: () => [...window.document.querySelectorAll('.problem-card')],
    visibleCards: () => [...window.document.querySelectorAll('.problem-card')].filter((c) => !c.hidden),
  };
}

test('la página carga sin errores y con las 6 tarjetas', (t) => {
  const p = loadPage();
  t.after(() => p.window.close());

  assert.deepEqual(p.jsdomErrors, []);
  assert.equal(p.cards().length, 6);
  assert.equal(p.$('#year').textContent, String(new Date().getFullYear()));
  // Sin IntersectionObserver (jsdom) el fallback debe dejar todo visible.
  assert.ok(p.$$('.reveal').every((el) => el.classList.contains('is-visible')));
  // Cada enlace interno apunta a un id existente.
  const ids = new Set(p.$$('[id]').map((el) => el.id));
  for (const a of p.$$('a[href^="#"]')) {
    const target = a.getAttribute('href').slice(1);
    if (target) assert.ok(ids.has(target), `falta el id "${target}"`);
  }
});

test('el buscador filtra las tarjetas y avisa cuando no hay resultados', (t) => {
  const p = loadPage();
  t.after(() => p.window.close());
  const input = p.$('#searchInput');

  input.value = 'presupuesto';
  p.fire(input, 'input');
  assert.deepEqual(p.visibleCards().map((c) => c.id), ['dinero']);
  assert.match(p.$('#results-count').textContent, /1 de 6/);

  // Sin acentos y por palabra clave: "wifi" vive en data-keywords de la tarjeta tech.
  input.value = 'wifi';
  p.fire(input, 'input');
  assert.deepEqual(p.visibleCards().map((c) => c.id), ['tech']);

  input.value = 'zzzz';
  p.fire(input, 'input');
  assert.equal(p.visibleCards().length, 0);
  assert.ok(p.$('#no-results').classList.contains('visible'));
  assert.equal(p.$('#problems-grid').style.display, 'none');

  p.click(p.$('#search-clear'));
  assert.equal(input.value, '');
  assert.equal(p.visibleCards().length, 6);
  assert.ok(!p.$('#no-results').classList.contains('visible'));
});

test('las etiquetas de tendencia llevan a su tarjeta y la resaltan', (t) => {
  const p = loadPage();
  t.after(() => p.window.close());
  const input = p.$('#searchInput');

  // Con un filtro que oculta la tarjeta destino, el clic debe limpiarlo primero.
  input.value = 'presupuesto';
  p.fire(input, 'input');
  p.click(p.$('.trend-tag[data-target="peso"]'));

  assert.equal(p.visibleCards().length, 6);
  assert.ok(p.$('#peso').classList.contains('is-highlight'));
});

test('los botones de guía muestran un toast mientras no exista la página', (t) => {
  const p = loadPage();
  t.after(() => p.window.close());

  p.click(p.$('.card-cta'));
  assert.ok(p.$('#toast').classList.contains('visible'));
  assert.ok(p.$('#toast-msg').textContent.length > 20);
});

test('el formulario valida el email y confirma la suscripción (demo)', (t) => {
  const p = loadPage();
  t.after(() => p.window.close());
  const email = p.$('#email');
  const submit = p.$('#email-form button[type=submit]');

  email.value = 'no-es-un-email';
  p.click(submit);
  assert.ok(email.classList.contains('invalid'));
  assert.ok(!p.$('#form-success').classList.contains('visible'));
  assert.match(p.$('#form-note').textContent, /Revisa el email/);

  email.value = 'maria@correo.com';
  p.fire(email, 'input');
  assert.ok(!email.classList.contains('invalid'));

  p.click(submit);
  assert.equal(p.$('#email-form').style.display, 'none');
  assert.ok(p.$('#form-success').classList.contains('visible'));
  assert.match(p.$('#form-success-email').textContent, /maria@correo\.com/);
});

test('el menú móvil abre, cierra con Escape y con clic en enlace', (t) => {
  const p = loadPage();
  t.after(() => p.window.close());
  const toggle = p.$('#nav-toggle');
  const header = p.$('#site-header');

  p.click(toggle);
  assert.ok(header.classList.contains('nav-open'));
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.match(toggle.querySelector('i').className, /fa-xmark/);

  p.doc.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(!header.classList.contains('nav-open'));
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');

  p.click(toggle);
  p.click(p.$('#nav-links a'));
  assert.ok(!header.classList.contains('nav-open'));
});

test('la cabecera marca el estado scrolled', (t) => {
  const p = loadPage();
  t.after(() => p.window.close());

  Object.defineProperty(p.window, 'scrollY', { value: 120, configurable: true });
  p.fire(p.window, 'scroll');
  assert.ok(p.$('#site-header').classList.contains('scrolled'));
});
