# ResuelveYa — landing estática

Landing page de una sola página (SPA estática, sin build) con las soluciones a los
problemas más buscados en Google: dinero, cansancio, tech, qué ver, DIY y salud.

Todo vive en [`index.html`](./index.html): HTML + CSS + JS vanilla en un único archivo,
sin dependencias que instalar. Las únicas peticiones externas son Google Fonts (Inter)
y Font Awesome 6.5.1 desde cdnjs.

## Verla en local

Cualquier servidor estático sirve. Opciones:

```bash
# Python (sin instalar nada)
python3 -m http.server 8080 --bind 0.0.0.0 --directory resuelveya

# Node
npx serve resuelveya
```

Después abre http://localhost:8080. También funciona abriendo `index.html`
directamente en el navegador (no necesita servidor).

## Tests

[`index.test.mjs`](./index.test.mjs) es un smoke test del comportamiento (buscador,
tendencias, formulario, menú móvil) ejecutado con jsdom, que ya está en los
`devDependencies` de la raíz del monorepo:

```bash
npm install                                    # una vez, en la raíz
node --test "resuelveya/**/*.test.mjs"          # 7 tests
```

## Qué incluye

- **Buscador funcional** en el hero: filtra las 6 tarjetas en vivo, ignora acentos y
  usa las palabras clave de `data-keywords` (p. ej. "wifi" → tarjeta de tech).
- **Etiquetas de tendencia**: hacen scroll a la tarjeta y la resaltan 2 s. Si un filtro
  la tenía oculta, se limpia el filtro primero.
- **Menú móvil** con hamburguesa, cierre con `Escape` y `aria-expanded`.
- **Nav activo** según la sección visible (IntersectionObserver).
- **Reveal on scroll** escalonado, con fallback si no hay IntersectionObserver y
  respeto por `prefers-reduced-motion`.
- **Formulario de suscripción** con validación de email y confirmación en línea (demo).
- Accesibilidad: skip link, labels ocultos, `aria-live`, foco visible, iconos `aria-hidden`.

## Pendiente / dónde enchufar cosas reales

| Punto | Dónde | Qué hacer |
| --- | --- | --- |
| Newsletter | `<script>` → listener de `#email-form` | Sustituir la confirmación simulada por un `fetch()` a tu proveedor (Buttondown, MailerLite, Brevo, Formspree…). |
| Guías completas | Botones `.card-cta` con `data-guide` | Ahora muestran un toast y llevan al CTA. Cámbialos por `<a href="/guias/…">` cuando existan las páginas. |
| Enlaces del footer | `Blog`, `Guías PDF`, `Privacidad`, `Términos`, `Contacto` | Apuntan a `#`; hay que crear esas rutas. |
| Dominio | `<link rel="canonical">` y metas Open Graph | Poner la URL real de producción. |
| Analítica | Final del `<body>` | Añadir Plausible/Umami/GA si se quiere medir. |
