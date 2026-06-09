import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vuepress'

interface GraphNode {
  id: string
  title: string
  path: string
  file: string
  tags: string[]
  categories: string[]
}

interface GraphEdge {
  source: string
  target: string
  type: 'link' | 'tag' | 'category'
  label?: string
}

interface PageInfo extends GraphNode {
  aliases: string[]
  content: string
}

interface KnowledgeGraphOptions {
  docsDir?: string
  includeTagEdges?: boolean
  includeCategoryEdges?: boolean
}

const __dirname = dirname(fileURLToPath(import.meta.url))

function slash(value: string): string {
  return value.split(sep).join('/')
}

function walkMarkdownFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') && entry !== '.vuepress') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (entry === '.vuepress' || entry === 'node_modules') continue
      files.push(...walkMarkdownFiles(full))
    } else if (entry.endsWith('.md')) {
      files.push(full)
    }
  }
  return files
}

function parseFrontmatter(source: string): { data: Record<string, unknown>; content: string } {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { data: {}, content: source }

  const data: Record<string, unknown> = {}
  const lines = match[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!pair) continue
    const key = pair[1]
    const raw = pair[2].trim()
    if (raw === '') continue
    if (raw.startsWith('[') && raw.endsWith(']')) {
      data[key] = raw.slice(1, -1).split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
    } else {
      data[key] = raw.replace(/^['"]|['"]$/g, '')
    }
  }

  return { data, content: source.slice(match[0].length) }
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function routeFromFile(sourceDir: string, file: string, frontmatter: Record<string, unknown>): string {
  const permalink = typeof frontmatter.permalink === 'string' ? frontmatter.permalink.trim() : ''
  if (permalink) return permalink.startsWith('/') ? permalink : `/${permalink}`

  const rel = slash(relative(sourceDir, file)).replace(/\.md$/, '')
  if (rel === 'README' || rel === 'index') return '/'
  if (rel.endsWith('/README') || rel.endsWith('/index')) return `/${rel.replace(/\/(?:README|index)$/, '')}/`
  return `/${rel}.html`
}

function titleFromContent(content: string, file: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim()
  if (heading) return heading
  const base = file.split(/[\\/]/).pop()?.replace(/\.md$/, '') ?? file
  return base === 'README' ? dirname(file).split(/[\\/]/).pop() ?? base : base
}

function buildAliasList(sourceDir: string, file: string, title: string, route: string): string[] {
  const rel = slash(relative(sourceDir, file)).replace(/\.md$/, '')
  const base = rel.split('/').pop() ?? rel
  const noReadme = rel.replace(/\/(?:README|index)$/, '')
  return Array.from(new Set([
    title,
    rel,
    noReadme,
    base,
    base.toLowerCase(),
    route,
    route.replace(/^\//, '').replace(/\/$/, ''),
    route.replace(/^\//, '').replace(/\.html$/, '')
  ].filter(Boolean)))
}

function collectPages(sourceDir: string): PageInfo[] {
  return walkMarkdownFiles(sourceDir).map((file) => {
    const raw = readFileSync(file, 'utf8')
    const { data, content } = parseFrontmatter(raw)
    const route = routeFromFile(sourceDir, file, data)
    const title = typeof data.title === 'string' ? data.title : titleFromContent(content, file)
    const node: PageInfo = {
      id: slash(relative(sourceDir, file)).replace(/\.md$/, ''),
      title,
      path: route,
      file: slash(relative(sourceDir, file)),
      tags: toArray(data.tags ?? data.tag),
      categories: toArray(data.categories ?? data.category),
      aliases: [],
      content
    }
    node.aliases = buildAliasList(sourceDir, file, title, route)
    return node
  })
}

function resolveTarget(rawTarget: string, page: PageInfo, aliases: Map<string, string>): string | null {
  const target = rawTarget
    .split('#')[0]
    .replace(/\\/g, '/')
    .replace(/\.md$/, '')
    .replace(/\/(?:README|index)$/, '')
    .trim()
  if (!target) return null

  const candidates = new Set<string>([target, target.toLowerCase()])
  if (target.startsWith('./') || target.startsWith('../')) {
    const pageDir = dirname(page.id)
    const normalized = slash(resolve('/', pageDir, target)).replace(/^\//, '')
    candidates.add(normalized)
    candidates.add(normalized.toLowerCase())
  }
  if (target.startsWith('/')) {
    candidates.add(target.replace(/^\//, '').replace(/\.html$/, '').replace(/\/$/, ''))
  }

  for (const candidate of candidates) {
    const found = aliases.get(candidate)
    if (found) return found
  }
  return null
}

function collectEdges(pages: PageInfo[], options: Required<Pick<KnowledgeGraphOptions, 'includeTagEdges' | 'includeCategoryEdges'>>): GraphEdge[] {
  const aliases = new Map<string, string>()
  for (const page of pages) {
    for (const alias of page.aliases) {
      aliases.set(alias, page.id)
      aliases.set(alias.toLowerCase(), page.id)
    }
  }

  const edgeKeys = new Set<string>()
  const edges: GraphEdge[] = []
  const addEdge = (source: string, target: string, type: GraphEdge['type'], label?: string): void => {
    if (!source || !target || source === target) return
    const key = type === 'link'
      ? `${source}->${target}:${type}`
      : [source, target].sort().join('--') + `:${type}:${label ?? ''}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push({ source, target, type, label })
  }

  for (const page of pages) {
    for (const match of page.content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
      const target = resolveTarget(match[1], page, aliases)
      if (target) addEdge(page.id, target, 'link')
    }
    for (const match of page.content.matchAll(/\[[^\]]+\]\((?!https?:|mailto:|#)([^)]+)\)/g)) {
      const target = resolveTarget(decodeURI(match[1].split(/\s+/)[0]), page, aliases)
      if (target) addEdge(page.id, target, 'link')
    }
  }

  const connectBy = (field: 'tags' | 'categories', type: 'tag' | 'category'): void => {
    const groups = new Map<string, PageInfo[]>()
    for (const page of pages) {
      for (const item of page[field]) {
        const key = item.trim()
        if (!key) continue
        groups.set(key, [...(groups.get(key) ?? []), page])
      }
    }
    for (const [label, group] of groups) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          addEdge(group[i].id, group[j].id, type, label)
        }
      }
    }
  }

  if (options.includeTagEdges) connectBy('tags', 'tag')
  if (options.includeCategoryEdges) connectBy('categories', 'category')
  return edges
}

export function knowledgeGraphPlugin(options: KnowledgeGraphOptions = {}): Plugin {
  return {
    name: 'vuepress-plugin-knowledge-graph',
    clientConfigFile: slash(join(__dirname, '../client/config.ts')),
    async onPrepared(app) {
      const sourceDir = options.docsDir ? resolve(options.docsDir) : app.dir.source()
      const pages = collectPages(sourceDir)
      const edges = collectEdges(pages, {
        includeTagEdges: options.includeTagEdges ?? true,
        includeCategoryEdges: options.includeCategoryEdges ?? true
      })
      const nodes: GraphNode[] = pages.map(({ content: _content, aliases: _aliases, ...node }) => node)
      await app.writeTemp(
        'knowledge-graph/data.js',
        `export const knowledgeGraphData = ${JSON.stringify({ nodes, edges }, null, 2)}\n`
      )
    }
  }
}
