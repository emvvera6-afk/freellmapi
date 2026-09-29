#!/usr/bin/env bash
# test-sale.sh — smoke-test a deployed catalog/licensing service end to end.
#
#   bash scripts/test-sale.sh https://TU-URL.onrender.com [ADMIN_TOKEN] [email]
#
# Steps: healthz → catalog feed serves → storefront shows manual checkout →
# test order is created → (with ADMIN_TOKEN) it gets fulfilled and the issued
# license validates. Each step prints ✓/✗; stops at the first failure with a
# hint about which env var to check in the Render dashboard.
set -uo pipefail

BASE="${1:-}"
TOKEN="${2:-}"
EMAIL="${3:-test-$(date +%s)@example.com}"

if [ -z "$BASE" ]; then
  echo "uso: bash scripts/test-sale.sh https://TU-URL.onrender.com [ADMIN_TOKEN] [email]"
  exit 2
fi
BASE="${BASE%/}"
FAIL=0

step() { echo; echo "── $1"; }
ok()   { echo "   ✓ $1"; }
bad()  { echo "   ✗ $1"; FAIL=1; }

# ── 1. healthz ────────────────────────────────────────────────────────────
step "1/5 healthz"
HEALTH=$(curl -sS --max-time 90 "$BASE/healthz" || echo "ERR")
if echo "$HEALTH" | grep -q '"ok":true'; then
  ok "servicio vivo: $HEALTH"
else
  bad "healthz respondió: $HEALTH"
  echo "      → primer arranque tras dormir tarda ~60 s (plan free); reintenta."
  echo "      → si persiste: revisa Deploy Logs en Render (puerto/healthCheckPath)."
fi

# ── 2. feed anónimo (tier mensual firmado) ────────────────────────────────
step "2/5 feed del catálogo (anónimo → monthly)"
HDR=$(curl -sS -D- -o /dev/null --max-time 60 "$BASE/v1/latest" || echo ERR)
if echo "$HDR" | grep -qi "x-catalog-signature"; then
  ok "catálogo firmado servido ($(echo "$HDR" | grep -i x-catalog-version | tr -d '\r'))"
else
  bad "falta x-catalog-signature"
fi

# ── 3. tienda en modo manual ──────────────────────────────────────────────
step "3/5 storefront (/buy visible + métodos de pago)"
HOME_HTML=$(curl -sS --max-time 60 "$BASE/" || echo ERR)
if echo "$HOME_HTML" | grep -q 'href="/buy?plan=annual"'; then
  ok "botones apuntan a /buy (modo manual activo)"
  echo "$HOME_HTML" | grep -qi "USDT" && ok "copia de pago USDT visible" || bad "la landing no muestra el método USDT — revisa PAY_USDT_ADDRESS"
else
  bad "la landing no muestra /buy — ¿CHECKOUT_MODE=manual está puesto?"
fi

# ── 4. crear pedido de prueba ─────────────────────────────────────────────
step "4/5 crear pedido de prueba ($EMAIL)"
ORDER=$(curl -sS --max-time 60 -X POST "$BASE/v1/orders" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"plan\":\"annual\",\"method\":\"usdt\"}" || echo ERR)
OID=$(echo "$ORDER" | grep -oE 'ORD-[0-9A-Z]+' | head -1)
if [ -n "$OID" ]; then
  ok "pedido $OID creado; instrucciones incluyen:"
  echo "$ORDER" | grep -oE 'USDT \(TRC20\)[^"]*' | head -1 | sed 's/^/      /'
  echo "      (además te llegó el ping '[order] $OID' a SUPPORT_EMAIL)"
else
  echo "      respuesta: $(echo "$ORDER" | head -c 200)"
  bad "no se creó el pedido — revisa PAY_USDT_ADDRESS / PAY_PAYPAL_URL"
fi

# ── 5. fulfill (requiere ADMIN_TOKEN) ─────────────────────────────────────
step "5/5 fulfill del pedido"
if [ -z "$OID" ]; then
  echo "   – saltado (sin pedido)"
elif [ -z "$TOKEN" ]; then
  echo "   → complétalo tú con tu ADMIN_TOKEN:"
  echo "     curl -s -X POST $BASE/v1/admin/orders/$OID/fulfill -H \"Authorization: Bearer TU_ADMIN_TOKEN\""
  echo "     (la clave llega por email a $EMAIL; aquí solo confirmamos emisión)"
else
  FUL=$(curl -sS --max-time 60 -X POST "$BASE/v1/admin/orders/$OID/fulfill" -H "Authorization: Bearer $TOKEN" || echo ERR)
  if echo "$FUL" | grep -q '"valid":true'; then
    ok "licencia emitida y válida: $FUL"
    echo "      → el comprador recibe su clave por email (revisa los logs de SendGrid si no llega)"
  elif echo "$FUL" | grep -q 'unauthorized'; then
    bad "401 unauthorized — el token no coincide con ADMIN_TOKEN en Render"
  else
    bad "respuesta inesperada: $(echo "$FUL" | head -c 200)"
  fi
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "🎉 Todo verde — la tienda está vendiendo."
else
  echo "⚠️  Hay pasos en ✗ — corrige esas variables en Render → save (redispliega) y vuelve a correr este script."
  exit 1
fi
