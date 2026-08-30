import { useEffect, useState } from 'react'
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
        {isCreate ? '新增 Docker 执行器' : `${type === 'local' ? 'Local' : 'Docker'} 执行器配置`}
      </h3>

      <div className="space-y-4">
        {isCreate && (
          <Field label="实例名称" hint="字母开头，可含字母/数字/_/-；节点包通过 executor.ref 引用此名称">
            <input
              className={inputCls}
              placeholder="docker-remote"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
        )}

        <Field label="描述">
          <input
            className={inputCls}
            placeholder={type === 'local' ? '本机 Shell 执行器' : '如：办公室构建机'}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>

        {type === 'docker' && (
          <>
            <Field
              label="Daemon 地址（host）"
              hint="留空使用本机/DOCKER_HOST；远程示例：tcp://192.168.1.10:2375 或 ssh://user@host"
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
                TLS 校验（tcp:// 远程 daemon 建议开启）
              </label>
            </div>

            {form.tlsVerify && (
              <Field label="TLS 证书目录" hint="目录内需含 ca.pem / cert.pem / key.pem，默认 ~/.docker">
                <input
                  className={inputCls}
                  placeholder="~/.docker"
                  value={form.certPath}
                  onChange={(e) => set('certPath', e.target.value)}
                />
              </Field>
            )}

            <Field label="镜像仓库（registry）">
              <input
                className={inputCls}
                placeholder="docker.io"
                value={form.registry}
                onChange={(e) => set('registry', e.target.value)}
              />
            </Field>

            <Field label="网络模式（network）">
              <input
                className={inputCls}
                placeholder="bridge"
                value={form.network}
                onChange={(e) => set('network', e.target.value)}
              />
            </Field>

            <Field
              label="卷挂载（volumes）"
              hint="每行一条 host:container[:ro]；注意远程 daemon 时 host 路径是远端机器上的路径"
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
            <Field label="默认超时（timeout）" hint="如 30s / 5m">
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
                启用伪终端（PTY）
              </label>
            </div>
          </>
        )}

        <Field label="工作目录（workdir）">
          <input
            className={inputCls}
            placeholder={type === 'local' ? '/tmp' : '/app'}
            value={form.workdir}
            onChange={(e) => set('workdir', e.target.value)}
          />
        </Field>

        <Field label="环境变量（env）" hint="每行一条 KEY=VALUE，注入到所有经此执行器运行的节点">
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
                     text-white text-sm font-medium hover:shadow-lg hover:shadow-indigo-500/30
                     transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? '保存中…' : isCreate ? '创建执行器' : '保存配置'}
        </button>
        {isCreate && onCancelCreate && (
          <button
            onClick={onCancelCreate}
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10
                       text-white/60 text-sm hover:bg-white/10 hover:text-white transition-all"
          >
            取消
          </button>
        )}
      </div>
    </GlassPanel>
  )
}
