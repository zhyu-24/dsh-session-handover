/**
 * Goal-scoped relevance excerpting for the finalize step.
 *
 * Pure string helpers: tokenize the user's goal / scope / custom text into
 * searchable keywords (ASCII words + CJK bigrams, minus stopwords), score each
 * transcript line by keyword hits, expand hit windows and return the matched
 * blocks in document order. When the seed yields no keywords or no line hits,
 * the caller falls back to plain head/tail truncation.
 */

const STOPWORDS = new Set([
  // Chinese
  '综合继续', '继续', '部分', '只要', '加上', '所有', '全部', '相关', '有关', '内容',
  '一个', '以及', '并且', '或者', '还有', '不要', '不需要', '排除', '忽略', '其他',
  '其余', '尽量', '可以', '应该', '需要', '重点', '主要', '注意', '的话', '其中',
  '的', '了', '和', '与', '在', '有', '是', '不', '要', '把', '就', '都', '我',
  '你', '他', '她', '它', '中', '上', '下', '里', '请', '这', '那', '个', '及',
  '会话', '工作', '文档', '文件', '问题', '功能', '什么', '怎么', '如何', '现在',
  '已经', '这个', '那个', '一些', '觉得', '感觉', '就是', '还是', '如果', '但是',
  '因为', '所以', '然后', '时候', '使用', '目标', '预测', '时候', '综合',
  // English
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'with', 'on', 'is',
  'are', 'be', 'not', 'no', 'session', 'dsh',
])

/** Extract ordered, deduped keyword tokens from free text. */
export function keywordTokens(seed: string): string[] {
  const text = String(seed || '').toLowerCase()
  const tokens: string[] = []
  for (const m of text.matchAll(/[a-z0-9][a-z0-9._/-]{1,}/g)) {
    const t = m[0]
    if (t.length >= 2 && !STOPWORDS.has(t)) tokens.push(t)
  }
  for (const run of text.matchAll(/[\u4e00-\u9fff]+/g)) {
    const s = run[0]
    if (s.length < 2) continue
    // 完整词 ≤4 字：本身不是停用词、且不含停用词二字片段时才保留（避免「加上部署」这类复合噪声）。
    if (s.length <= 4 && !STOPWORDS.has(s)) {
      let hasStop = false
      for (let i = 0; i + 1 < s.length; i++) {
        if (STOPWORDS.has(s.slice(i, i + 2))) {
          hasStop = true
          break
        }
      }
      if (!hasStop) tokens.push(s)
    }
    for (let i = 0; i + 1 < s.length; i++) {
      const b = s.slice(i, i + 2)
      if (STOPWORDS.has(b)) continue
      // 跳过跨界噪声 bigram：首字符是前一个停用词的尾字符（如「加上部署」的「上部」），
      // 或尾字符是后一个停用词的首字符（如「部署综合」的「署综」）。
      const left = i > 0 ? s.slice(i - 1, i + 1) : ''
      const right = i + 2 < s.length ? s.slice(i + 1, i + 3) : ''
      if ((left && STOPWORDS.has(left)) || (right && STOPWORDS.has(right))) continue
      tokens.push(b)
    }
  }
  return Array.from(new Set(tokens))
}

const LINE_CAP = 800
const WINDOW = 2

interface Block {
  text: string
  score: number
  start: number
}

/**
 * Return the goal-relevant excerpt of `fullText`, in document order, up to
 * `budget` chars. Returns the full text when no keywords exist (caller should
 * truncate), and an empty string when keywords exist but nothing matched
 * (caller should fall back too).
 */
export function excerptFor(fullText: string, seed: string, budget = 16000): string {
  const text = String(fullText || '')
  const tokens = keywordTokens(seed)
  if (!tokens.length || !text) return text
  const lines = text.split('\n')
  const scores: number[] = new Array(lines.length).fill(0)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase()
    let score = 0
    for (const t of tokens) {
      if (line.includes(t)) score += /^[a-z0-9._/-]+$/.test(t) ? 3 : 1
    }
    scores[i] = score
  }
  const hits = new Set<number>()
  for (let i = 0; i < lines.length; i++) {
    if (scores[i] > 0) {
      for (let j = Math.max(0, i - WINDOW); j <= Math.min(lines.length - 1, i + WINDOW); j++) hits.add(j)
    }
  }
  if (!hits.size) return ''
  const idx = Array.from(hits).sort((a: number, b: number) => a - b)
  const blocks: Block[] = []
  let start = idx[0]
  let prev = idx[0]
  for (let k = 1; k < idx.length; k++) {
    const i = idx[k]
    if (i - prev <= WINDOW) {
      prev = i
      continue
    }
    blocks.push(makeBlock(lines, scores, start, prev))
    start = i
    prev = i
  }
  blocks.push(makeBlock(lines, scores, start, prev))
  let out = blocks.map((b) => b.text).join('\n----\n')
  // 摘录过小（如只误命中候选列表那一行）视为无有效命中，交由调用方回退整段转录。
  if (out.length < 300) return ''
  if (out.length <= budget) return out
  // Over budget: drop the weakest blocks first, then restore document order.
  const kept: Block[] = []
  let used = 0
  for (const b of blocks.slice().sort((x, y) => y.score - x.score || x.start - y.start)) {
    if (used + b.text.length > budget && kept.length) continue
    kept.push(b)
    used += b.text.length
  }
  return kept
    .sort((a, b) => a.start - b.start)
    .map((b) => b.text)
    .join('\n----\n')
}

function makeBlock(lines: string[], scores: number[], a: number, b: number): Block {
  const slice = lines.slice(a, b + 1).map((l) => (l.length > LINE_CAP ? l.slice(0, LINE_CAP) + '…' : l))
  let score = 0
  for (let i = a; i <= b; i++) score += scores[i]
  return { text: slice.join('\n'), score, start: a }
}
