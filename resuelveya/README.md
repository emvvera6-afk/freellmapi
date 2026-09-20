# ResuelveYa — landing estática

Landing page de una sola página (estática, sin build) con las soluciones a los
problemas más buscados en Google: dinero, cansancio, tech, qué ver, DIY y salud.

Todo vive en [`index.html`](./index.html): HTML + CSS + JS vanilla en un único archivo,
sin dependencias que instalar. Las únicas peticiones externas son Google Fonts (Inter),
Font Awesome 6.5.1 desde cdnjs y, si la activas, la suscripción a Buttondown.

## Verla en local

Cualquier servidor estático sirve:

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
tendencias, formulario en modo demo y en modo Buttondown, menú móvil) ejecutado con
jsdom, que ya está en los `devDependencies` de la raíz del monorepo:

```bash
npm install                                    # una vez, en la raíz
node --test "resuelveya/**/*.test.mjs"          # 8 tests
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
- **Newsletter con Buttondown** (ver abajo): validación de email, confirmación en
  línea y modo demo mientras no configures tu usuario.
- Accesibilidad: skip link, labels ocultos, `aria-live`, foco visible, iconos
  `aria-hidden`.

## Newsletter (Buttondown)

**Para activarla solo hay que tocar un sitio:** el `action` del formulario
`#email-form`, donde ahora pone el placeholder `TU-USUARIO-BUTTONDOWN`:

```html
<form
  id="email-form"
  action="https://buttondown.com/api/emails/embed-subscribe/TU-USUARIO-BUTTONDOWN"
  method="post"
  target="buttondown-frame"
>
```

Ese último segmento es tu usuario de Buttondown (el de `buttondown.com/<usuario>`; lo
tienes también en **Settings → Embedding**). Al ponerlo, el JS detecta que ya no es el
placeholder y pasa de modo demo a modo real: POST nativo al iframe oculto
`buttondown-frame`, mensaje de "revisa tu correo" y enlace de rescate a tu página de
Buttondown.

Por qué está montado así y no con `fetch()`:

- La doc de Buttondown dice explícitamente que el endpoint `embed-subscribe` **debe**
  ser el `action` de un `<form>` HTML estándar y **no** debe llamarse con la API `fetch`
  de JavaScript: a veces responde con un CAPTCHA o un error de validación que el
  visitante tiene que poder seguir.
- El `target="buttondown-frame"` confina esa respuesta en un iframe oculto para que la
  persona no salga de la landing. Como el iframe es opaco, la UI no puede leer el
  resultado: el mensaje es neutro ("revisa tu correo") y la confirmación autoritativa
  es el correo de **double opt-in** que envía Buttondown.
- El endpoint público no necesita API key en el navegador. La API REST
  (`https://api.buttondown.com/v1/subscribers`) sí la necesita y **no admite CORS**
  desde el navegador, así que llamarla directamente desde la página fallaría.
- En el camino válido el JS nunca llama a `preventDefault()` (si lo hiciera, el
  formulario se vería perfecto y no enviaría nada) y el campo de email pasa a
  `readOnly`, nunca a `disabled`: un control deshabilitado no se serializa y el email
  se perdería del POST.

Ajustes habituales:

| Quieres | Dónde |
| --- | --- |
| Etiquetar suscriptores por origen | `<input type="hidden" name="tag" value="landing">` (ahora `landing`) |
| Pedir nombre u otros datos | Inputs `name="metadata__clave"` creados antes en **Settings → Subscribing** |
| Embed con estilo de Buttondown | Cambia el formulario por `<iframe src="https://buttondown.com/<usuario>?as_embed=true">` |
| Suscribir desde tu backend | `POST https://api.buttondown.com/v1/subscribers` con `Authorization: Token $BUTTONDOWN_API_KEY` y body `{"email_address":"…","tags":["landing"]}` — la key siempre fuera del navegador (un Worker como los de `examples/` vale) |

## Pendiente

| Punto | Dónde | Qué hacer |
| --- | --- | --- |
| Guías completas | Botones `.card-cta` con `data-guide` | Ahora muestran un toast y llevan al CTA. Cámbialos por `<a href="/guias/…">` cuando existan las páginas. |
| Enlaces del footer | `Blog`, `Guías PDF`, `Privacidad`, `Términos`, `Contacto` | Apuntan a `#`; hay que crear esas rutas. |
| Dominio | `<link rel="canonical">` y metas Open Graph | Poner la URL real de producción. |
| Analítica | Final del `<body>` | Añadir Plausible/Umami/GA si se quiere medir. |
