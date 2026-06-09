import type { Plugin } from 'vuepress'

export interface KnowledgeGraphOptions {
  docsDir?: string
  includeTagEdges?: boolean
  includeCategoryEdges?: boolean
}

export declare function knowledgeGraphPlugin(options?: KnowledgeGraphOptions): Plugin
