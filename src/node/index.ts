import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addViteOptimizeDepsInclude } from '@vuepress/helper'
import matter from 'gray-matter'
import type { Plugin } from 'vuepress'

interface GraphNode {
  id: string
  title: string
  path: string
  file: string
  tags: string[]
  kind: 'note' | 'tag' | 'attachment' | 'missing'
}

interface GraphEdge {
  source: string
  target: string
  type: 'link' | 'tag' | 'attachment'
  label?: string
}

interface PageInfo extends GraphNode {
  aliases: string[]
  content: string
}

interface KnowledgeGraphOptions {
  docsDir?: string
  includeTags?: boolean
  includeAttachments?: boolean
  includeMissing?: boolean
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
  const parsed = matter(source)
  return {
    data: parsed.data as Record<string, unknown>,
    content: parsed.content
  }
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
      kind: 'note',
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
    const pageDir = posix.dirname(page.id)
    const normalized = posix.resolve('/', pageDir, target).replace(/^\//, '')
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

function collectGraph(
  sourceDir: string,
  pages: PageInfo[],
  options: Required<Pick<KnowledgeGraphOptions, 'includeTags' | 'includeAttachments' | 'includeMissing'>>
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const aliases = new Map<string, string>()
  for (const page of pages) {
    for (const alias of page.aliases) {
      aliases.set(alias, page.id)
      aliases.set(alias.toLowerCase(), page.id)
    }
  }

  const edgeKeys = new Set<string>()
  const edges: GraphEdge[] = []
  const extraNodes = new Map<string, GraphNode>()
  const addEdge = (source: string, target: string, type: GraphEdge['type'], label?: string): void => {
    if (!source || !target || source === target) return
    const key = type === 'link'
      ? [source, target].sort().join('--') + `:${type}`
      : `${source}->${target}:${type}:${label ?? ''}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push({ source, target, type, label })
  }
  const addExtraNode = (node: GraphNode): void => {
    if (!extraNodes.has(node.id)) extraNodes.set(node.id, node)
  }
  const decodeTarget = (value: string): string => {
    try {
      return decodeURI(value)
    } catch {
      return value
    }
  }
  const normalizeAsset = (rawTarget: string, page: PageInfo): { id: string; title: string; path: string; file: string } | null => {
    const target = decodeTarget(rawTarget.split(/[?#]/)[0].trim()).replace(/\\/g, '/')
    if (!target || /^(?:https?:|mailto:|data:|#)/i.test(target) || /\.md$/i.test(target)) return null
    const pageDir = posix.dirname(page.file)
    const relativeFile = target.startsWith('/')
      ? target.replace(/^\/+/, '')
      : posix.resolve('/', pageDir, target).replace(/^\/+/, '')
    const sourceRoot = resolve(sourceDir)
    const absoluteFile = resolve(sourceRoot, relativeFile)
    const publicFile = resolve(sourceRoot, '.vuepress/public', relativeFile)
    if (!absoluteFile.startsWith(sourceRoot)) return null
    if (!existsSync(absoluteFile) && !existsSync(publicFile)) return null
    const title = relativeFile.split('/').pop() ?? relativeFile
    return {
      id: `attachment:${relativeFile}`,
      title,
      path: target.startsWith('/') ? target : `/${relativeFile}`,
      file: relativeFile
    }
  }
  const addMissingNode = (rawTarget: string, page: PageInfo): string | null => {
    const target = decodeTarget(rawTarget.split('#')[0].trim()).replace(/\\/g, '/').replace(/\.md$/i, '')
    if (!target) return null
    const pageDir = posix.dirname(page.id)
    const normalized = target.startsWith('/')
      ? target.replace(/^\/+/, '')
      : posix.resolve('/', pageDir, target).replace(/^\/+/, '')
    if (!normalized || normalized === '.') return null
    const id = `missing:${normalized.toLowerCase()}`
    addExtraNode({
      id,
      title: target.split('/').pop() ?? target,
      path: '',
      file: normalized,
      tags: [],
      kind: 'missing'
    })
    return id
  }

  for (const page of pages) {
    for (const match of page.content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
      const rawTarget = match[1]
      const asset = options.includeAttachments ? normalizeAsset(rawTarget, page) : null
      if (asset && /\.[a-z0-9]{1,12}$/i.test(asset.file)) {
        addExtraNode({ ...asset, tags: [], kind: 'attachment' })
        addEdge(page.id, asset.id, 'attachment')
        continue
      }
      const target = resolveTarget(rawTarget, page, aliases)
      if (target) addEdge(page.id, target, 'link')
      else if (options.includeMissing) {
        const missing = addMissingNode(rawTarget, page)
        if (missing) addEdge(page.id, missing, 'link')
      }
    }
    for (const match of page.content.matchAll(/!?\[[^\]]*\]\((?!https?:|mailto:|data:|#)([^)]+)\)/gi)) {
      const rawTarget = match[1].trim().replace(/\s+["'][^"']*["']$/, '')
      const asset = options.includeAttachments ? normalizeAsset(rawTarget, page) : null
      if (asset && /\.[a-z0-9]{1,12}$/i.test(asset.file) && !/\.md$/i.test(asset.file)) {
        addExtraNode({ ...asset, tags: [], kind: 'attachment' })
        addEdge(page.id, asset.id, 'attachment')
        continue
      }
      const target = resolveTarget(decodeTarget(rawTarget), page, aliases)
      if (target) addEdge(page.id, target, 'link')
      else if (options.includeMissing) {
        const missing = addMissingNode(rawTarget, page)
        if (missing) addEdge(page.id, missing, 'link')
      }
    }
    if (options.includeTags) {
      for (const rawTag of page.tags) {
        const tag = rawTag.trim()
        if (!tag) continue
        const id = `tag:${tag.toLowerCase()}`
        addExtraNode({
          id,
          title: `#${tag}`,
          path: '',
          file: '',
          tags: [tag],
          kind: 'tag'
        })
        addEdge(page.id, id, 'tag', tag)
      }
    }
  }

  const noteNodes: GraphNode[] = pages.map(({ content: _content, aliases: _aliases, ...node }) => node)
  return { nodes: [...noteNodes, ...extraNodes.values()], edges }
}

export function knowledgeGraphPlugin(options: KnowledgeGraphOptions = {}): Plugin {
  return {
    name: 'vuepress-plugin-knowledge-graph',
    clientConfigFile: slash(join(__dirname, '../client/config.ts')),
    extendsBundlerOptions(bundlerOptions, app) {
      addViteOptimizeDepsInclude(bundlerOptions, app, 'force-graph')
    },
    async onPrepared(app) {
      const sourceDir = options.docsDir ? resolve(options.docsDir) : app.dir.source()
      const pages = collectPages(sourceDir)
      const graph = collectGraph(sourceDir, pages, {
        includeTags: options.includeTags ?? true,
        includeAttachments: options.includeAttachments ?? true,
        includeMissing: options.includeMissing ?? true
      })
      await app.writeTemp(
        'knowledge-graph/data.js',
        `export const knowledgeGraphData = ${JSON.stringify(graph, null, 2)}\n`
      )
    }
  }
}
