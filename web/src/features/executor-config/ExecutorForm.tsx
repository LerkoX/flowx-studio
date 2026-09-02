import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import GlassPanel from '@/components/GlassPanel'
import type { Executor, ExecutorCreateInput, ExecutorType, ExecutorUpdateInput } from '@/types/executor'

interface ExecutorFormProps {
  /** 编辑现有实例；null 表示新增 Docker 实例 */
  executor: Executor | null
  saving: boolean
  error?: string | null
  onSave: (input: ExecutorCreateInput | ExecutorUpdateInput) => Promise<void>
  onCancelCreate?: () => void
}

/** 文本编辑状态：复杂字段用多行文本编辑，保存时转换为结构化值 */
interface FormState {
  name: string
  description: string
  host: string
  tlsVerify: boolean
  certPath: string
  registry: string
  network: string
  workdir: string
  volumesText: string // 每行一个 host:container[:ro]
  envText: string     // 每行一个 KEY=VALUE
  tty: boolean
  shell: string
  timeout: string
  pty: boolean
}

function toFormState(executor: Executor | null): FormState {
  const cfg = executor?.config ?? {}
  const s = (k: string) => (typeof cfg[k] === 'string' ? (cfg[k] as string) : '')
  const b = (k: string) => cfg[k] === true
  const volumes = Array.isArray(cfg.volumes) ? (cfg.volumes as string[]).join('\n') : ''
  const env =
    cfg.env && typeof cfg.env === 'object'
      ? Object.entries(cfg.env as Record<string, string>)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n')
      : ''
  return {
    name: executor?.name ?? '',
    description: executor?.description ?? '',
    host: s('host'),
    tlsVerify: b('tlsVerify'),
    certPath: s('certPath'),
    registry: s('registry'),
    network: s('network'),
    workdir: s('workdir'),
    volumesText: volumes,
    envText: env,
    tty: b('tty'),
    shell: s('shell'),
    timeout: s('timeout'),
    pty: b('pty'),
  }
}

/** 组装 config：空值剔除，多行文本转结构化 */
function buildConfig(type: ExecutorType, f: FormState): Record<string, unknown> {
  const cfg: Record<string, unknown> = {}
  const putStr = (key: string, val: string) => {
    if (val.trim() !== '') cfg[key] = val.trim()
  }
  if (type === 'local') {
    putStr('shell', f.shell)
    putStr('workdir', f.workdir)
    putStr('timeout', f.timeout)
    if (f.pty) cfg.pty = true
  } else {
    putStr('host', f.host)
    if (f.tlsVerify) cfg.tlsVerify = true
    putStr('certPath', f.certPath)
    putStr('registry', f.registry)
    putStr('network', f.network)
    putStr('workdir', f.workdir)
    if (f.tty) cfg.tty = true
    const volumes = f.volumesText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '')
    if (volumes.length > 0) cfg.volumes = volumes
  }
  const env: Record<string, string> = {}
  f.envText.split('\n').forEach((line) => {
    const idx = line.indexOf('=')
    if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1)
  })
  if (Object.keys(env).length > 0) cfg.env = env
  return cfg
}

const inputCls = `w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10
  text-white/90 text-sm placeholder:text-white/20 font-mono
  focus:outline-none focus:border-white/20 focus:bg-white/[0.07] transition-all`

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-white/60 text-xs mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-white/30 text-xs mt-1">{hint}</p>}
    </div>
  )
}

export default function ExecutorForm({ executor, saving, error, onSave, onCancelCreate }: ExecutorFormProps) {
  const { t } = useTranslation()
  const isCreate = executor === null
  const type: ExecutorType = executor?.type ?? 'docker'
  const [form, setForm] = useState<FormState>(() => toFormState(executor))

  useEffect(() => {
    setForm(toFormState(executor))
  }, [executor])

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }))

  const handleSubmit = async () => {
    const config = buildConfig(type, form)
    if (isCreate) {
      await onSave({ name: form.name.trim(), type: 'docker', description: form.description.trim(), config })
    } else {
      await onSave({ description: form.description.trim(), config })
    }
  }

  return (
    <GlassPanel className="p-6">
      <h3 className="text-white/90 font-semibold text-sm mb-4">
        {isCreate ? t('executor.addDocker') : t('executor.configTitle', { type: type === 'local' ? 'Local' : 'Docker' })}
      </h3>

      <div className="space-y-4">
        {isCreate && (
          <Field label={t('executor.instanceName')} hint={t('executor.instanceNameHint')}>
            <input
              className={inputCls}
              placeholder="docker-remote"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
        )}

        <Field label={t('executor.description')}>
          <input
            className={inputCls}
            placeholder={type === 'local' ? t('executor.localDescPlaceholder') : t('executor.dockerDescPlaceholder')}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>

        {type === 'docker' && (
          <>
            <Field
              label={t('executor.hostLabel')}
              hint={t('executor.hostHint')}
            >
              <input
                className={inputCls}
                placeholder="tcp://192.168.1.10:2375"
                value={form.host}
                onChange={(e) => set('host', e.target.value)}
              />
            </Field>

            <div className="flex items-center gap-2">
              <input
                id="tlsVerify"
                type="checkbox"
                checked={form.tlsVerify}
                onChange={(e) => set('tlsVerify', e.target.checked)}
                className="accent-indigo-500"
              />
              <label htmlFor="tlsVerify" className="text-white/60 text-xs">
                {t('executor.tlsVerify')}
              </label>
            </div>

            {form.tlsVerify && (
              <Field label={t('executor.tlsCertPath')} hint={t('executor.tlsCertHint')}>
                <input
                  className={inputCls}
                  placeholder="~/.docker"
                  value={form.certPath}
                  onChange={(e) => set('certPath', e.target.value)}
                />
              </Field>
            )}

            <Field label={t('executor.registryLabel')}>
              <input
                className={inputCls}
                placeholder="docker.io"
                value={form.registry}
                onChange={(e) => set('registry', e.target.value)}
              />
            </Field>

            <Field label={t('executor.networkLabel')}>
              <input
                className={inputCls}
                placeholder="bridge"
                value={form.network}
                onChange={(e) => set('network', e.target.value)}
              />
            </Field>

            <Field
              label={t('executor.volumesLabel')}
              hint={t('executor.volumesHint')}
            >
              <textarea
                className={inputCls + ' h-20 resize-y'}
                placeholder={'/data:/data:ro'}
                value={form.volumesText}
                onChange={(e) => set('volumesText', e.target.value)}
              />
            </Field>
          </>
        )}

        {type === 'local' && (
          <>
            <Field label="Shell">
              <input
                className={inputCls}
                placeholder="bash"
                value={form.shell}
                onChange={(e) => set('shell', e.target.value)}
              />
            </Field>
            <Field label={t('executor.timeoutLabel')} hint={t('executor.timeoutHint')}>
              <input
                className={inputCls}
                placeholder="30s"
                value={form.timeout}
                onChange={(e) => set('timeout', e.target.value)}
              />
            </Field>
            <div className="flex items-center gap-2">
              <input
                id="pty"
                type="checkbox"
                checked={form.pty}
                onChange={(e) => set('pty', e.target.checked)}
                className="accent-indigo-500"
              />
              <label htmlFor="pty" className="text-white/60 text-xs">
                {t('executor.pty')}
              </label>
            </div>
          </>
        )}

        <Field label={t('executor.workdirLabel')}>
          <input
            className={inputCls}
            placeholder={type === 'local' ? '/tmp' : '/app'}
            value={form.workdir}
            onChange={(e) => set('workdir', e.target.value)}
          />
        </Field>

        <Field label={t('executor.envLabel')} hint={t('executor.envHint')}>
          <textarea
            className={inputCls + ' h-20 resize-y'}
            placeholder={'HTTP_PROXY=http://proxy:8080'}
            value={form.envText}
            onChange={(e) => set('envText', e.target.value)}
          />
        </Field>
      </div>

      {error && <p className="text-rose-400 text-xs mt-3">{error}</p>}

      <div className="mt-6 flex gap-3">
        <button
          onClick={handleSubmit}
          disabled={saving || (isCreate && form.name.trim() === '')}
          className="px-4 py-2 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500
                     text-on-accent text-sm font-medium hover:shadow-lg hover:shadow-indigo-500/30
                     transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? t('executor.saving') : isCreate ? t('executor.createExecutor') : t('executor.saveConfig')}
        </button>
        {isCreate && onCancelCreate && (
          <button
            onClick={onCancelCreate}
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10
                       text-white/60 text-sm hover:bg-white/10 hover:text-white transition-all"
          >
            {t('common.cancel')}
          </button>
        )}
      </div>
    </GlassPanel>
  )
}
