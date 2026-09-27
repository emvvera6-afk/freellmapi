import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  ArrowUpRight,
  Bot,
  Code2,
  Copy,
  KeyRound,
  Plus,
  RotateCw,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '@/lib/api'
import { copyText } from '@/lib/clipboard'
import { toast } from '@/lib/toast'
import { useI18n } from '@/i18n'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { ConfirmButton } from '@/components/confirm-button'

interface ProfileUsage {
  requests: number
  inputTokens: number
  outputTokens: number
  lastUsedAt: string | null
}

type WorkspaceRole = 'member' | 'developer' | 'service'

interface WorkspaceProfile {
  id: number
  name: string
  email: string | null
  role: WorkspaceRole
  maskedKey: string
  systemPrompt: string | null
  enabled: boolean
  usage: ProfileUsage
  createdAt: string
  updatedAt: string
}

type ProfileWithKey = WorkspaceProfile & { key: string }

const COPY = {
  en: {
    title: 'Workspace',
    description: 'Give every teammate or service its own revocable key and see who is using your model pool.',
    addAccess: 'Add access',
    hideForm: 'Close',
    activeAccess: 'Active access',
    requestsMonth: 'Requests this month',
    tokensMonth: 'Tokens this month',
    lastActivity: 'Last activity',
    noActivity: 'No activity yet',
    controlTitle: 'One pool, separate access',
    controlDescription: 'Provider credentials stay with the owner. Members only receive a scoped Muxora key that you can pause or rotate at any time.',
    createTitle: 'Create workspace access',
    createDescription: 'The API key is shown once after creation. Share it through a secure channel.',
    displayName: 'Name',
    namePlaceholder: 'e.g. Ana or Production bot',
    email: 'Email (optional)',
    emailPlaceholder: 'ana@company.com',
    role: 'Access type',
    member: 'Member',
    developer: 'Developer',
    service: 'Service',
    prompt: 'Enforced instructions (optional)',
    promptPlaceholder: 'Instructions that are always added before this access key’s requests…',
    create: 'Create access',
    creating: 'Creating…',
    keyOnce: 'Copy this key now. For security, the full value will not be shown again.',
    copyKey: 'Copy key',
    accessTitle: 'Members and services',
    accessDescription: 'Each key works with the OpenAI, Anthropic, Gemini, and key-protected Ollama interfaces.',
    emptyTitle: 'No workspace access yet',
    emptyDescription: 'Create a separate key for a teammate, app, or automation instead of sharing the owner key.',
    enabled: 'Access enabled',
    rotate: 'Rotate key',
    requests: 'requests',
    tokens: 'tokens',
    neverUsed: 'Never used',
    used: 'Last used',
    noEmail: 'No email',
    planEyebrow: 'Muxora Teams · Early access',
    planTitle: 'Turn this workspace into a managed team gateway.',
    planDescription: 'Team pricing includes shared routing, attributable usage, separate access keys, live catalog updates, and priority support.',
    seePlans: 'See plans',
  },
  es: {
    title: 'Equipo',
    description: 'Dale a cada persona o servicio su propia clave revocable y descubre quién utiliza tu conjunto de modelos.',
    addAccess: 'Añadir acceso',
    hideForm: 'Cerrar',
    activeAccess: 'Accesos activos',
    requestsMonth: 'Solicitudes este mes',
    tokensMonth: 'Tokens este mes',
    lastActivity: 'Última actividad',
    noActivity: 'Sin actividad todavía',
    controlTitle: 'Un conjunto, accesos separados',
    controlDescription: 'Las credenciales de proveedores permanecen con el propietario. Los miembros solo reciben una clave de Muxora que puedes pausar o rotar en cualquier momento.',
    createTitle: 'Crear acceso para el equipo',
    createDescription: 'La clave API se muestra una sola vez. Compártela mediante un canal seguro.',
    displayName: 'Nombre',
    namePlaceholder: 'Ej. Ana o Bot de producción',
    email: 'Correo (opcional)',
    emailPlaceholder: 'ana@empresa.com',
    role: 'Tipo de acceso',
    member: 'Miembro',
    developer: 'Desarrollador',
    service: 'Servicio',
    prompt: 'Instrucciones obligatorias (opcional)',
    promptPlaceholder: 'Instrucciones que siempre se añaden antes de las solicitudes de esta clave…',
    create: 'Crear acceso',
    creating: 'Creando…',
    keyOnce: 'Copia esta clave ahora. Por seguridad, el valor completo no volverá a mostrarse.',
    copyKey: 'Copiar clave',
    accessTitle: 'Miembros y servicios',
    accessDescription: 'Cada clave funciona con las interfaces OpenAI, Anthropic, Gemini y Ollama protegido por clave.',
    emptyTitle: 'Todavía no hay accesos de equipo',
    emptyDescription: 'Crea una clave independiente para una persona, aplicación o automatización en lugar de compartir la clave del propietario.',
    enabled: 'Acceso habilitado',
    rotate: 'Rotar clave',
    requests: 'solicitudes',
    tokens: 'tokens',
    neverUsed: 'Nunca se ha usado',
    used: 'Último uso',
    noEmail: 'Sin correo',
    planEyebrow: 'Muxora Teams · Acceso anticipado',
    planTitle: 'Convierte este espacio en una pasarela administrada para tu equipo.',
    planDescription: 'El plan Team incluye enrutamiento compartido, uso atribuible, claves independientes, catálogo en vivo y soporte prioritario.',
    seePlans: 'Ver planes',
  },
} as const

function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function roleIcon(role: WorkspaceRole) {
  if (role === 'service') return Bot
  if (role === 'developer') return Code2
  return UserRound
}

export default function WorkspacePage() {
  const { locale, t } = useI18n()
  const copy = locale.startsWith('es') ? COPY.es : COPY.en
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<WorkspaceRole>('member')
  const [prompt, setPrompt] = useState('')
  const [revealedKey, setRevealedKey] = useState<{ id: number; key: string } | null>(null)

  const { data: profiles = [], isLoading } = useQuery<WorkspaceProfile[]>({
    queryKey: ['client-profiles'],
    queryFn: () => apiFetch('/api/client-profiles'),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['client-profiles'] })

  const create = useMutation({
    mutationFn: () => apiFetch<ProfileWithKey>('/api/client-profiles', {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(),
        email: email.trim() || null,
        role,
        systemPrompt: prompt.trim() || null,
      }),
    }),
    onSuccess: (created) => {
      setName('')
      setEmail('')
      setRole('member')
      setPrompt('')
      setShowForm(false)
      setRevealedKey({ id: created.id, key: created.key })
      void invalidate()
    },
  })

  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: number; enabled: boolean }) =>
      apiFetch(`/api/client-profiles/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => void invalidate(),
  })

  const rotate = useMutation({
    mutationFn: (id: number) => apiFetch<ProfileWithKey>(`/api/client-profiles/${id}/rotate`, { method: 'POST' }),
    onSuccess: (profile) => {
      setRevealedKey({ id: profile.id, key: profile.key })
      void invalidate()
    },
  })

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/client-profiles/${id}`, { method: 'DELETE' }),
    onSuccess: (_result, id) => {
      setRevealedKey(current => current?.id === id ? null : current)
      void invalidate()
    },
  })

  const summary = useMemo(() => {
    const requests = profiles.reduce((sum, profile) => sum + profile.usage.requests, 0)
    const tokens = profiles.reduce((sum, profile) => sum + profile.usage.inputTokens + profile.usage.outputTokens, 0)
    const latest = profiles
      .map(profile => profile.usage.lastUsedAt)
      .filter((date): date is string => Boolean(date))
      .sort()
      .at(-1) ?? null
    return {
      active: profiles.filter(profile => profile.enabled).length,
      requests,
      tokens,
      latest,
    }
  }, [profiles])

  async function copyKey(key: string) {
    if (!await copyText(key)) {
      toast.error(t('common.copyFailed'))
      return
    }
    toast.success(t('common.copied'))
  }

  return (
    <div>
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <Button size="sm" onClick={() => setShowForm(current => !current)}>
            {showForm ? copy.hideForm : <><Plus className="size-3.5" />{copy.addAccess}</>}
          </Button>
        }
      />

      <div className="space-y-6">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: copy.activeAccess, value: isLoading ? '—' : String(summary.active), icon: Users },
            { label: copy.requestsMonth, value: isLoading ? '—' : compactNumber(summary.requests), icon: Activity },
            { label: copy.tokensMonth, value: isLoading ? '—' : compactNumber(summary.tokens), icon: KeyRound },
            {
              label: copy.lastActivity,
              value: summary.latest ? new Date(`${summary.latest}Z`).toLocaleDateString() : copy.noActivity,
              icon: ShieldCheck,
            },
          ].map(metric => (
            <div key={metric.label} className="rounded-2xl border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">{metric.label}</p>
                <metric.icon className="size-4 text-primary" />
              </div>
              <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{metric.value}</p>
            </div>
          ))}
        </section>

        <section className="relative overflow-hidden rounded-3xl border bg-card p-5 sm:p-6">
          <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_center,var(--brand-glow),transparent_68%)] opacity-70" />
          <div className="relative flex max-w-2xl items-start gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <h2 className="font-medium">{copy.controlTitle}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{copy.controlDescription}</p>
            </div>
          </div>
        </section>

        {showForm && (
          <section className="rounded-3xl border bg-card p-5 sm:p-6">
            <div className="mb-5">
              <h2 className="text-sm font-medium">{copy.createTitle}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{copy.createDescription}</p>
            </div>
            <form
              className="grid gap-4 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (name.trim()) create.mutate()
              }}
            >
              <label className="space-y-1.5 text-xs font-medium">
                {copy.displayName}
                <Input value={name} onChange={event => setName(event.target.value)} placeholder={copy.namePlaceholder} maxLength={100} autoFocus />
              </label>
              <label className="space-y-1.5 text-xs font-medium">
                {copy.email}
                <Input value={email} onChange={event => setEmail(event.target.value)} placeholder={copy.emailPlaceholder} type="email" maxLength={254} />
              </label>
              <label className="space-y-1.5 text-xs font-medium">
                {copy.role}
                <select
                  value={role}
                  onChange={event => setRole(event.target.value as WorkspaceRole)}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50 dark:bg-input/30"
                >
                  <option value="member">{copy.member}</option>
                  <option value="developer">{copy.developer}</option>
                  <option value="service">{copy.service}</option>
                </select>
              </label>
              <label className="space-y-1.5 text-xs font-medium md:row-span-2">
                {copy.prompt}
                <Textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={copy.promptPlaceholder} rows={4} maxLength={32000} />
              </label>
              <div className="flex items-end">
                <Button type="submit" size="sm" disabled={!name.trim() || create.isPending}>
                  <Plus className="size-3.5" />
                  {create.isPending ? copy.creating : copy.create}
                </Button>
              </div>
            </form>
          </section>
        )}

        {revealedKey && (
          <section className="rounded-3xl border border-primary/30 bg-primary/[0.04] p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{copy.keyOnce}</p>
                <code className="mt-2 block truncate rounded-xl border bg-background px-3 py-2.5 font-mono text-xs select-all">{revealedKey.key}</code>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" onClick={() => void copyKey(revealedKey.key)}>
                  <Copy className="size-3.5" />{copy.copyKey}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setRevealedKey(null)}>{t('common.dismiss')}</Button>
              </div>
            </div>
          </section>
        )}

        <section>
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium">{copy.accessTitle}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{copy.accessDescription}</p>
            </div>
            <Badge variant="outline">{profiles.length}</Badge>
          </div>

          <div className="overflow-hidden rounded-3xl border bg-card">
            {!isLoading && profiles.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-14 text-center">
                <div className="mb-4 flex size-11 items-center justify-center rounded-2xl bg-muted">
                  <Users className="size-5 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">{copy.emptyTitle}</p>
                <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">{copy.emptyDescription}</p>
                <Button className="mt-5" size="sm" onClick={() => setShowForm(true)}>
                  <Plus className="size-3.5" />{copy.addAccess}
                </Button>
              </div>
            ) : (
              <ul className="divide-y">
                {profiles.map(profile => {
                  const Icon = roleIcon(profile.role)
                  const totalTokens = profile.usage.inputTokens + profile.usage.outputTokens
                  return (
                    <li key={profile.id} className={`p-4 sm:p-5 ${profile.enabled ? '' : 'opacity-60'}`}>
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted">
                            <Icon className="size-4 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-medium">{profile.name}</p>
                              <Badge variant="secondary" className="text-[10px]">
                                {copy[profile.role]}
                              </Badge>
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                              <span>{profile.email || copy.noEmail}</span>
                              <span aria-hidden="true">·</span>
                              <code className="font-mono">{profile.maskedKey}</code>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4 text-xs sm:w-[320px]">
                          <div>
                            <p className="font-medium tabular-nums">{compactNumber(profile.usage.requests)}</p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">{copy.requests}</p>
                          </div>
                          <div>
                            <p className="font-medium tabular-nums">{compactNumber(totalTokens)}</p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">{copy.tokens}</p>
                          </div>
                          <div>
                            <p className="truncate font-medium">
                              {profile.usage.lastUsedAt
                                ? new Date(`${profile.usage.lastUsedAt}Z`).toLocaleDateString()
                                : copy.neverUsed}
                            </p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">{copy.used}</p>
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-1.5">
                          <Switch
                            size="sm"
                            checked={profile.enabled}
                            onCheckedChange={enabled => update.mutate({ id: profile.id, enabled })}
                            aria-label={copy.enabled}
                          />
                          <ConfirmButton
                            onConfirm={() => rotate.mutate(profile.id)}
                            size="icon-xs"
                            armedSize="xs"
                            confirmLabel={copy.rotate}
                            title={copy.rotate}
                            aria-label={copy.rotate}
                          >
                            <RotateCw className="size-3.5" />
                          </ConfirmButton>
                          <ConfirmButton
                            onConfirm={() => remove.mutate(profile.id)}
                            size="icon-xs"
                            armedSize="xs"
                            armedClassName="text-destructive"
                            title={t('common.delete')}
                            aria-label={t('common.delete')}
                          >
                            <Trash2 className="size-3.5" />
                          </ConfirmButton>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border bg-[linear-gradient(135deg,var(--brand-surface),transparent)] p-5 sm:p-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-medium text-primary">{copy.planEyebrow}</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight">{copy.planTitle}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy.planDescription}</p>
            </div>
            <Button className="shrink-0" onClick={() => navigate('/plans')}>
              {copy.seePlans}<ArrowUpRight className="size-4" />
            </Button>
          </div>
        </section>
      </div>
    </div>
  )
}
