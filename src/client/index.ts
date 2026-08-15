/**
 * dsh-session-handover — browser half.
 *
 * Renders the Derive header button, the candidate-selection panel, and the
 * new-session jump with opening-line prefill. Talks to the host half over the
 * loopback /api/dsh-handover routes (plain fetch). Failure policy: DOM
 * mounting problems are logged, never thrown — the web shell fails the whole
 * boot when a plugin apply throws.
 */

import * as React from 'react'

/** Services required before the browser surfaces can mount. */
export const inject = ['slots', 'workspaces', 'sessions']

async function apiCall(name: string, payload: unknown): Promise<any> {
  const res = await fetch('/api/dsh-handover/' + name, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload || {}),
  })
  let data: any = {}
  try {
    data = await res.json()
  } catch {}
  if (!res.ok) {
    throw new Error((data && data.error) || 'HTTP ' + res.status)
  }
  return data
}

export function apply(ctx: any): void {
  const slots = ctx.get('slots')
  const workspaces = ctx.get('workspaces')
  const sessions = ctx.get('sessions')
  if (slots === undefined || workspaces === undefined || sessions === undefined) return

  let pendingPrefill: { sessionId: string | null; text: string } | null = null
  const store = {
    open: false, phase: 'idle', error: null, notice: '',
    sessionId: null, workspaceId: null, wsItems: [], parentTitle: '', chars: 0,
    candidates: [], checked: {}, custom: '', doc: null,
    listeners: new Set(),
    emit() { for (const l of Array.from(this.listeners)) l() },
  }

  function useStore() {
    const [, bump] = React.useReducer((x: number) => x + 1, 0)
    React.useEffect(() => {
      store.listeners.add(bump)
      return () => { store.listeners.delete(bump) }
    }, [])
    return store
  }

  const colors = {
    bg: 'var(--ds-color-bg-elevated, #1f1f27)',
    border: 'var(--ds-color-border, #3a3a46)',
    fg: 'var(--ds-color-text-primary, #ececf1)',
    dim: 'var(--ds-color-text-secondary, #9a9aa6)',
    accent: 'var(--ds-color-accent, #4f7cff)',
    danger: 'var(--ds-color-danger, #e5534b)',
  }

  function prefillMatches(sessionId: string | null | undefined) {
    return pendingPrefill && (pendingPrefill.sessionId === null || pendingPrefill.sessionId === sessionId)
  }

  function applyPrefill(props: any, s: any) {
    if (!prefillMatches(props.sessionId)) return false
    if (!props.inputActions || typeof props.inputActions.setDraft !== 'function') return false
    try {
      props.inputActions.setDraft(pendingPrefill!.text)
      pendingPrefill = null
      if (s) s.emit()
      return true
    } catch {
      return false
    }
  }

  function PrefillConsumer(props: any) {
    const s = useStore()
    const appliedRef = React.useRef(false)
    React.useEffect(() => {
      if (!appliedRef.current) {
        appliedRef.current = applyPrefill(props, s)
      }
    }, [props.sessionId, props.inputActions])
    if (!prefillMatches(props.sessionId)) return null
    return React.createElement('div', {
      style: {
        display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px',
        border: '1px dashed ' + colors.border, borderRadius: 8, marginBottom: 6,
        background: colors.bg, fontSize: 12,
      },
    },
      React.createElement('div', { style: { color: colors.dim } }, '开场白（可手动复制到输入框）：'),
      React.createElement('div', {
        style: { whiteSpace: 'pre-wrap', color: colors.fg },
      }, pendingPrefill ? pendingPrefill.text : ''),
      React.createElement('div', null,
        React.createElement('button', {
          onClick: () => { if (!applyPrefill(props, s)) s.emit() },
          style: { padding: '2px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid ' + colors.border, background: 'transparent', color: colors.fg },
        }, '填入输入框'),
      ),
    )
  }

  function DeriveButton(props: any) {
    const wsState = props.useWorkspaces
      ? props.useWorkspaces((s: any) => s)
      : null
    const workspaceId = wsState ? wsState.recentWorkspaceId : undefined
    React.useEffect(() => {
      applyPrefill(props, null)
    }, [props.sessionId, props.inputActions])
    const onClick = () => {
      store.sessionId = props.sessionId
      store.workspaceId = workspaceId
      store.wsItems = wsState ? (wsState.items || []).map((w: any) => ({ workspaceId: w.workspaceId, path: w.path })) : []
      store.open = true
      store.phase = 'analyzing'
      store.error = null
      store.notice = ''
      store.chars = 0
      store.candidates = []
      store.checked = {}
      store.emit()
      apiCall('analyze', { sessionId: props.sessionId }).then((res) => {
        const list = (res && res.candidates) || []
        store.candidates = list
        store.checked = {}
        for (const c of list) store.checked[c.label] = false
        store.parentTitle = (res && res.parentTitle) || ''
        store.chars = (res && res.chars) || 0
        store.notice = list.length ? '' : '未能生成候选目标，请直接输入自定义目标，或关掉面板重试。'
        store.phase = 'picking'
        store.emit()
      }, (err: any) => {
        store.phase = 'error'
        store.error = String((err && err.message) || err)
        store.emit()
      })
    }
    return React.createElement('button', {
      onClick,
      disabled: !props.sessionId,
      title: '派生新会话：预测延续目标、生成交接文档并跳转新会话',
      style: {
        padding: '2px 10px', borderRadius: 6, cursor: 'pointer',
        border: '1px solid ' + colors.border, background: 'transparent',
        color: colors.fg, fontSize: 12, lineHeight: '20px',
      },
    }, '派生')
  }

  function DerivePanel() {
    const s = useStore()
    if (!s.open) return null
    const toggle = (label: string) => { s.checked[label] = !s.checked[label]; s.emit() }
    const setCustom = (ev: any) => { s.custom = ev.target.value; s.emit() }
    const close = () => { s.open = false; s.emit() }
    const confirm = () => {
      const picked = s.candidates.filter((c: any) => s.checked[c.label])
      const chosen = picked.map((c: any) => c.label)
      const scope = picked.map((c: any) => String(c.description || '').trim()).filter(Boolean).join('；')
      const custom = String(s.custom || '').trim()
      if (!chosen.length && !custom) { s.error = '请勾选至少一个目标，或输入自定义目标'; s.emit(); return }
      s.phase = 'writing'
      s.error = null
      s.emit()
      apiCall('finalize', { sessionId: s.sessionId, chosen, custom, scope }).then((res) => {
        s.doc = {
          filename: (res && res.docPath) || '',
          md: (res && res.md) || '',
          prefill: (res && res.prefill) || '',
          parentCwd: (res && res.parentCwd) || '',
        }
        s.phase = 'done'
        s.emit()
      }, (err: any) => {
        s.phase = 'error'
        s.error = String((err && err.message) || err)
        s.emit()
      })
    }

    const goNext = () => {
      const d = s.doc || {}
      // 新会话工作目录与父会话对齐：优先选择 path 与父会话 cwd 一致的工作区。
      let targetWs = s.workspaceId
      const parentCwd = d.parentCwd || ''
      if (parentCwd && s.wsItems && s.wsItems.length) {
        const hit = s.wsItems.find((w: any) => String(w.path || '').toLowerCase() === parentCwd.toLowerCase())
        if (hit) targetWs = hit.workspaceId
      }
      const closePanel = () => { s.open = false; s.phase = 'idle'; s.emit() }
      if (targetWs) {
        workspaces.connectWorkspace(targetWs).then((newId: string) => {
          pendingPrefill = { sessionId: newId, text: d.prefill || '' }
          closePanel()
          sessions.open(newId)
        }, (err: any) => {
          s.phase = 'error'
          s.error = '新会话创建失败：' + String((err && err.message) || err)
          s.emit()
        })
      } else {
        pendingPrefill = { sessionId: null, text: d.prefill || '' }
        closePanel()
        workspaces.startSession()
      }
    }

    const copyDoc = () => {
      const text = (s.doc && s.doc.md) || ''
      const done = () => { s.notice = '已复制全文到剪贴板'; s.emit() }
      const fail = () => { s.notice = '复制失败，请手动选择复制'; s.emit() }
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fail)
        return
      }
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        done()
      } catch { fail() }
    }
    const phaseText: Record<string, string> = {
      analyzing: '正在分析会话，预测新会话目标…',
      picking: s.parentTitle ? '父会话：' + s.parentTitle : '选择新会话目标',
      writing: '正在生成交接文档…',
      done: '交接文档已生成',
      error: '出错了',
    }
    const children = [
      React.createElement('div', { key: 'title', style: { fontWeight: 600, fontSize: 14, marginBottom: 8 } }, '派生新会话'),
    ]
    if (s.phase === 'analyzing' || s.phase === 'writing') {
      children.push(React.createElement('div', { key: 'phase', style: { color: colors.dim, marginBottom: 8 } }, phaseText[s.phase] || ''))
    }
    if (s.phase === 'picking') {
      const statText = (s.chars > 0 ? '已分析 ' + s.chars + ' 字符' : '') + (s.candidates.length ? '，预测到 ' + s.candidates.length + ' 个目标' : '')
      children.push(React.createElement('div', { key: 'hint', style: { color: colors.dim, marginBottom: 8 } },
        '勾选要延续的目标（多选 = 合并成一个目标）；或直接输入自定义目标：' + (statText ? '（' + statText + '）' : '')))
      for (const c of s.candidates) {
        children.push(React.createElement('label', {
          key: 'cand-' + c.label,
          style: { display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8, cursor: 'pointer' },
        },
          React.createElement('input', { type: 'checkbox', checked: !!s.checked[c.label], onChange: () => toggle(c.label), style: { marginTop: 2 } }),
          React.createElement('span', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
            React.createElement('span', { style: { fontWeight: 500 } }, c.label),
            c.description ? React.createElement('span', { style: { color: colors.dim, fontSize: 12 } }, c.description) : null,
          ),
        ))
      }
      children.push(React.createElement('textarea', {
        key: 'custom', value: s.custom, onChange: setCustom, rows: 2,
        placeholder: '自定义目标（如：只要 SSH 部分，加上部署）',
        style: {
          width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: 6,
          background: colors.bg, color: colors.fg, border: '1px solid ' + colors.border,
          borderRadius: 6, fontSize: 13, marginBottom: 10, fontFamily: 'inherit',
        },
      }))
    }
    if (s.phase === 'done') {
      const d = s.doc || {}
      children.push(React.createElement('div', { key: 'done-title', style: { fontWeight: 600, marginBottom: 4 } },
        '交接文档已生成：' + (d.filename || '')))
      if (d.md) {
        children.push(React.createElement('pre', {
          key: 'done-md',
          style: {
            maxHeight: '44vh', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            margin: '8px 0', padding: 10, border: '1px solid ' + colors.border, borderRadius: 8,
            background: colors.bg, color: colors.fg, fontSize: 12, lineHeight: '18px',
          },
        }, d.md))
      }
    }
    if (s.notice) {
      children.push(React.createElement('div', { key: 'notice', style: { color: '#d9a441', marginBottom: 8 } }, s.notice))
    }
    if (s.error) {
      children.push(React.createElement('div', { key: 'error', style: { color: colors.danger, marginBottom: 8 } }, s.error))
    }
    if (s.phase === 'picking') {
      children.push(React.createElement('div', { key: 'actions', style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
        React.createElement('button', {
          onClick: close,
          style: { padding: '4px 12px', borderRadius: 6, cursor: 'pointer', border: '1px solid ' + colors.border, background: 'transparent', color: colors.fg },
        }, '取消'),
        React.createElement('button', {
          onClick: confirm,
          style: { padding: '4px 12px', borderRadius: 6, cursor: 'pointer', border: 'none', background: colors.accent, color: '#fff' },
        }, '生成并新开会话'),
      ))
    }
    if (s.phase === 'error') {
      children.push(React.createElement('div', { key: 'close', style: { display: 'flex', justifyContent: 'flex-end' } },
        React.createElement('button', {
          onClick: close,
          style: { padding: '4px 12px', borderRadius: 6, cursor: 'pointer', border: '1px solid ' + colors.border, background: 'transparent', color: colors.fg },
        }, '关闭'),
      ))
    }
    if (s.phase === 'done') {
      children.push(React.createElement('div', { key: 'done-actions', style: { display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' } },
        React.createElement('button', {
          onClick: copyDoc,
          style: { padding: '4px 12px', borderRadius: 6, cursor: 'pointer', border: '1px solid ' + colors.border, background: 'transparent', color: colors.fg },
        }, '复制全文'),
        React.createElement('button', {
          onClick: close,
          style: { padding: '4px 12px', borderRadius: 6, cursor: 'pointer', border: '1px solid ' + colors.border, background: 'transparent', color: colors.fg },
        }, '关闭'),
        React.createElement('button', {
          onClick: goNext,
          style: { padding: '4px 12px', borderRadius: 6, cursor: 'pointer', border: 'none', background: colors.accent, color: '#fff' },
        }, '前往新会话'),
      ))
    }
    return React.createElement('div', {
      style: {
        position: 'fixed', top: 64, right: 16, width: 360, maxHeight: '78vh', overflowY: 'auto',
        zIndex: 1000, background: colors.bg, border: '1px solid ' + colors.border, borderRadius: 10,
        padding: 16, boxShadow: '0 12px 32px rgba(0,0,0,0.4)', color: colors.fg, fontSize: 13,
      },
    }, children)
  }

  slots.inject('conversation.session.header.actions', () => slots.register(
    { name: 'conversation.session.header.actions', id: 'handover-derive', order: 30, label: '派生' },
    (props: any) => React.createElement(DeriveButton, props),
  ))

  slots.inject('conversation.composer.dock', () => slots.register(
    { name: 'conversation.composer.dock', id: 'handover-prefill-composer', order: -100 },
    (props: any) => React.createElement(PrefillConsumer, props),
  ))

  slots.inject('conversation.input.dock', () => slots.register(
    { name: 'conversation.input.dock', id: 'handover-prefill-input', order: -100 },
    (props: any) => React.createElement(PrefillConsumer, props),
  ))

  slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: 'handover-panel', order: 0 },
    () => React.createElement(DerivePanel),
  ))
}
