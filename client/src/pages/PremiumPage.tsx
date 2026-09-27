import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, RefreshCw, Sparkles, Users } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { FieldError } from '@/components/ui/field-error'
import { CardSkeleton } from '@/components/ui/skeleton'
import { usePremium } from '@/hooks/use-premium'
import { useI18n } from '@/i18n'

function fmtWhen(ms: number | null): string | null {
  if (!ms) return null
  return new Date(ms).toLocaleString()
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

const PLAN_COPY = {
  en: {
    title: 'Plans & billing',
    description: 'Start with the local gateway, then add faster catalog updates or a managed team workspace.',
    pricing: 'Simple plans, built around your own provider keys',
    pricingHint: 'Muxora charges for control, updates, and support — not for reselling provider credits.',
    current: 'Current',
    community: 'Community',
    communityPrice: '$0',
    communityPeriod: 'forever',
    communityFeatures: ['Self-hosted AI gateway', 'Smart routing and failover', 'Monthly model catalog'],
    live: 'Live',
    livePrice: '$19',
    livePeriod: 'per year',
    liveFeatures: ['Everything in Community', 'Same-day catalog updates', 'One license for every device'],
    team: 'Team',
    teamPrice: '$49',
    teamPeriod: 'per month · early access',
    teamFeatures: ['Everything in Live', 'Separate member and service keys', 'Attributable monthly usage', 'Priority setup support'],
    chooseLive: 'Choose Live',
    contact: 'Request Team access',
    recommended: 'Recommended',
  },
  es: {
    title: 'Planes y facturación',
    description: 'Empieza con la pasarela local y añade un catálogo más rápido o un espacio administrado para tu equipo.',
    pricing: 'Planes simples alrededor de tus propias claves de proveedor',
    pricingHint: 'Muxora cobra por control, actualizaciones y soporte, no por revender créditos de proveedores.',
    current: 'Actual',
    community: 'Community',
    communityPrice: '0 $',
    communityPeriod: 'para siempre',
    communityFeatures: ['Pasarela de IA autohospedada', 'Enrutamiento y conmutación inteligente', 'Catálogo mensual de modelos'],
    live: 'Live',
    livePrice: '19 $',
    livePeriod: 'al año',
    liveFeatures: ['Todo lo incluido en Community', 'Catálogo actualizado el mismo día', 'Una licencia para todos tus dispositivos'],
    team: 'Team',
    teamPrice: '49 $',
    teamPeriod: 'al mes · acceso anticipado',
    teamFeatures: ['Todo lo incluido en Live', 'Claves separadas por miembro o servicio', 'Uso mensual atribuible', 'Soporte prioritario de configuración'],
    chooseLive: 'Elegir Live',
    contact: 'Solicitar acceso Team',
    recommended: 'Recomendado',
  },
} as const

export default function PremiumPage() {
  const { locale, t } = useI18n()
  const plans = locale.startsWith('es') ? PLAN_COPY.es : PLAN_COPY.en
  const queryClient = useQueryClient()
  const [keyInput, setKeyInput] = useState('')
  const [activateAttempted, setActivateAttempted] = useState(false)

  const { data, isLoading, licensed } = usePremium()

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['premium'] })
    // A sync may have changed the model list and quirks.
    queryClient.invalidateQueries({ queryKey: ['models'] })
  }

  const activate = useMutation({
    meta: { silenceToast: true },
    mutationFn: (key: string) =>
      apiFetch('/api/premium/key', { method: 'POST', body: JSON.stringify({ key }) }),
    onSuccess: () => {
      setKeyInput('')
      invalidate()
    },
  })

  const removeKey = useMutation({
    mutationFn: () => apiFetch('/api/premium/key', { method: 'DELETE' }),
    onSuccess: invalidate,
  })

  const syncNow = useMutation({
    mutationFn: () => apiFetch('/api/premium/sync', { method: 'POST' }),
    onSuccess: invalidate,
  })

  const openPortal = useMutation({
    meta: { silenceToast: true },
    mutationFn: () => apiFetch<{ url: string }>('/api/premium/portal', { method: 'POST' }),
    onSuccess: ({ url }) => {
      window.open(url, '_blank', 'noopener')
    },
  })

  if (isLoading || !data) {
    return (
      <div>
        <PageHeader title={plans.title} description={plans.description} />
        <div className="space-y-6">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    )
  }

  const { hasKey, maskedKey, license, catalog, siteUrl } = data
  const live = catalog.appliedTier === 'live'
  return (
    <div>
      <PageHeader
        title={plans.title}
        description={plans.description}
        actions={
          <Button variant="outline" size="sm" onClick={() => syncNow.mutate()} disabled={syncNow.isPending}>
            <RefreshCw className={syncNow.isPending ? 'animate-spin' : ''} />
            {syncNow.isPending ? t('premium.syncing') : t('premium.checkForUpdates')}
          </Button>
        }
      />

      <div className="space-y-8">
        <section>
          <div className="mb-3">
            <h2 className="text-sm font-medium">{plans.pricing}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{plans.pricingHint}</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="flex flex-col rounded-3xl border bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">{plans.community}</p>
                {!licensed && <Badge variant="secondary">{plans.current}</Badge>}
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-semibold tracking-tight">{plans.communityPrice}</span>
                <span className="text-xs text-muted-foreground">{plans.communityPeriod}</span>
              </div>
              <ul className="mt-5 flex-1 space-y-2">
                {plans.communityFeatures.map(feature => (
                  <li key={feature} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />{feature}
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative flex flex-col rounded-3xl border border-primary/35 bg-primary/[0.035] p-5 shadow-[0_18px_50px_-35px_var(--primary)]">
              <Badge className="absolute right-4 top-4">{plans.recommended}</Badge>
              <div className="flex items-center justify-between gap-3 pr-24">
                <p className="text-sm font-medium">{plans.live}</p>
                {licensed && <Badge variant="secondary">{plans.current}</Badge>}
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-semibold tracking-tight">{plans.livePrice}</span>
                <span className="text-xs text-muted-foreground">{plans.livePeriod}</span>
              </div>
              <ul className="mt-5 flex-1 space-y-2">
                {plans.liveFeatures.map(feature => (
                  <li key={feature} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />{feature}
                  </li>
                ))}
              </ul>
              {!licensed && (
                <a href={`${siteUrl}/#pricing`} target="_blank" rel="noopener noreferrer" className="mt-5">
                  <Button className="w-full" size="sm">{plans.chooseLive}<ExternalLink className="size-3.5" /></Button>
                </a>
              )}
            </div>

            <div className="flex flex-col rounded-3xl border bg-card p-5">
              <div className="flex items-center gap-2">
                <Users className="size-4 text-primary" />
                <p className="text-sm font-medium">{plans.team}</p>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-semibold tracking-tight">{plans.teamPrice}</span>
                <span className="text-xs text-muted-foreground">{plans.teamPeriod}</span>
              </div>
              <ul className="mt-5 flex-1 space-y-2">
                {plans.teamFeatures.map(feature => (
                  <li key={feature} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />{feature}
                  </li>
                ))}
              </ul>
              <a href="mailto:support@freellmapi.co?subject=Muxora%20Team%20early%20access" className="mt-5">
                <Button variant="outline" className="w-full" size="sm">{plans.contact}<ExternalLink className="size-3.5" /></Button>
              </a>
            </div>
          </div>
        </section>

        {/* Catalog feed state */}
        <section>
          <h2 className="text-sm font-medium mb-3">{t('premium.catalogFeed')}</h2>
          <div className="rounded-3xl border bg-card p-5">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex items-center gap-2">
                <span className={`inline-block size-2 rounded-full ${live ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                <span className="text-sm font-medium">{live ? t('premium.liveFeed') : t('premium.monthlySnapshot')}</span>
                <Badge variant="outline" className="font-mono text-[11px]">
                  {catalog.appliedVersion ?? t('premium.bundled')}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground">{t('premium.lastChecked', { when: fmtWhen(catalog.lastSyncMs) ?? t('common.never') })}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              {live
                ? t('premium.liveDescription')
                : t('premium.snapshotDescription')}
            </p>
            {catalog.lastError && (
              <p className="text-destructive text-xs mt-2">{t('premium.lastSyncProblem', { error: catalog.lastError })}</p>
            )}
          </div>
        </section>

        {/* License */}
        <section>
          <h2 className="text-sm font-medium mb-3">{t('premium.license')}</h2>
          {hasKey ? (
            <div className="rounded-3xl border bg-card p-5 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-sm">{maskedKey}</span>
                {licensed ? (
                  <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-transparent">
                    {license?.plan === 'annual'
                      ? t('premium.planAnnual')
                      : license?.plan === 'lifetime'
                        ? t('premium.planLifetime')
                        : t('premium.planGeneric')}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-destructive border-destructive/40">
                    {license?.reason === 'expired' ? t('premium.expired') : t('premium.inactive')}
                  </Badge>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                {licensed && license?.plan === 'lifetime' && t('premium.lifetimeNote')}
                {licensed && license?.plan === 'annual' && !license.cancelAtPeriodEnd && license.expiresAt &&
                  t('premium.renewsOn', { date: fmtDate(license.expiresAt) })}
                {licensed && license?.plan === 'annual' && license.cancelAtPeriodEnd && license.expiresAt &&
                  t('premium.willNotRenew', { date: fmtDate(license.expiresAt) })}
                {!licensed &&
                  t('premium.keyInactive')}
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => openPortal.mutate()} disabled={openPortal.isPending}>
                  <ExternalLink />
                  {openPortal.isPending ? t('premium.openingPortal') : t('premium.manageSubscription')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeKey.mutate()}
                  disabled={removeKey.isPending}
                  className="text-muted-foreground"
                >
                  {t('premium.removeKey')}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t('premium.manageHint')}
              </p>
              {openPortal.isError && (
                <p className="text-destructive text-xs">{(openPortal.error as Error).message}</p>
              )}
            </div>
          ) : (
            <div className="rounded-3xl border bg-card p-5 space-y-4">
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!keyInput.trim()) {
                    setActivateAttempted(true)
                    return
                  }
                  setActivateAttempted(false)
                  activate.mutate(keyInput.trim())
                }}
              >
                <div className="space-y-1.5 flex-1 min-w-[260px]">
                  <Label className="text-xs">{t('premium.licenseKey')}</Label>
                  <Input
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder="fla_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                    className="font-mono text-xs"
                    autoComplete="off"
                    aria-invalid={activateAttempted && !keyInput.trim()}
                  />
                  {activateAttempted && !keyInput.trim() && <FieldError error={t('validation.required')} />}
                </div>
                <Button type="submit" size="sm" disabled={activate.isPending}>
                  {activate.isPending ? t('premium.activating') : t('premium.activate')}
                </Button>
              </form>
              {activate.isError && (
                <p className="text-destructive text-xs">{(activate.error as Error).message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {t('premium.keyHint')}{' '}
                <a className="underline hover:text-foreground" href={`${siteUrl}/manage.html`} target="_blank" rel="noopener noreferrer">
                  {t('premium.recoverKey')}
                </a>
                .
              </p>
            </div>
          )}
        </section>

        {/* Upsell, only when not licensed */}
        {!licensed && (
          <section>
            <div className="rounded-3xl border bg-card p-5 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <Sparkles className="size-4 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{t('premium.upsellTitle')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('premium.upsellDescription')}
                  </p>
                </div>
              </div>
              <a
                href={`${siteUrl}/#pricing`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0"
              >
                <Button size="sm">
                  {t('premium.goPremium')}
                  <ExternalLink />
                </Button>
              </a>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
