import type { Plugin } from 'vuepress'

export interface KnowledgeGraphOptions {
  docsDir?: string
  includeTags?: boolean
  includeAttachments?: boolean
  includeMissing?: boolean
}

export declare function knowledgeGraphPlugin(options?: KnowledgeGraphOptions): Plugin
