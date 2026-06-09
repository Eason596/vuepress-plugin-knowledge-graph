# vuepress-plugin-knowledge-graph

一个用于 VuePress 2 的知识图谱插件。它会在构建阶段扫描 Markdown 文件，根据 Obsidian 风格双链、相对 Markdown 链接、标签和分类生成关系图，并在站点右下角提供一个可打开、可拖拽调整宽度的图谱侧边栏。

## 功能

- 自动扫描 `docs/**/*.md`
- 支持 Obsidian 双链：`[[目标页面]]`、`[[目标页面|显示文本]]`、`[[目标页面#标题]]`
- 支持相对 Markdown 链接：`[标题](./目标页面.md)`
- 可选根据 `tags` / `tag` 建立标签关系
- 可选根据 `categories` / `category` 建立分类关系
- 右下角悬浮按钮打开图谱侧边栏
- 侧边栏可拖拽调整宽度
- 打开图谱时自动聚焦当前页面节点
- 双击节点跳转到对应页面
- 鼠标悬停节点时，高亮当前节点、关联节点和关联边

## 安装

如果你把这个仓库发布到 npm：

```bash
npm install vuepress-plugin-knowledge-graph
```

如果你先在本地使用，可以把仓库放在 VuePress 项目旁边，然后使用本地路径安装：

```bash
npm install ../vuepress-plugin-knowledge-graph
```

也可以先不安装，直接在 VuePress 配置里用相对路径导入源码入口：

```ts
import { knowledgeGraphPlugin } from '../../../vuepress-plugin-knowledge-graph/src/node'
```

## 使用

在 `.vuepress/config.ts` 中注册插件：

```ts
import { defineUserConfig } from 'vuepress'
import { knowledgeGraphPlugin } from 'vuepress-plugin-knowledge-graph'

export default defineUserConfig({
  plugins: [
    knowledgeGraphPlugin(),
  ],
})
```

插件注册后，会自动在所有页面右下角显示图谱按钮，不需要单独创建图谱页面。

## 配置项

```ts
knowledgeGraphPlugin({
  docsDir: '/absolute/path/to/docs',
  includeTagEdges: true,
  includeCategoryEdges: true,
})
```

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `docsDir` | `string` | VuePress source dir | Markdown 扫描目录。通常不需要设置。 |
| `includeTagEdges` | `boolean` | `true` | 是否把相同标签的页面连接起来。 |
| `includeCategoryEdges` | `boolean` | `true` | 是否把相同分类的页面连接起来。 |

## Markdown 写法

页面之间的关系可以直接使用 Obsidian 常见写法：

```md
这篇文章关联到 [[另一篇笔记]]。
这篇文章也关联到 [[论文/Segment Anything|SAM 论文]]。
```

也可以使用普通 Markdown 相对链接：

```md
[查看相关笔记](./related.md)
```

标签和分类可以写在 frontmatter 中：

```md
---
title: Segment Anything
tags: [vision, foundation-model]
categories: [paper]
---
```

## 在页面中手动插入图谱

除了默认侧边栏，你也可以在任意 Markdown 页面中直接插入完整图谱组件：

```md
<KnowledgeGraph />
```

## 开发

仓库入口：

- `index.js`：npm 包运行入口
- `index.d.ts`：类型声明
- `src/node/index.ts`：VuePress 插件源码入口
- `src/client/config.ts`：VuePress 客户端配置
- `src/client/components/KnowledgeGraph.vue`：图谱画布组件
- `src/client/components/KnowledgeGraphSidebar.vue`：右侧图谱侧边栏

本插件依赖 VuePress 2 和 Vue 3，由使用方站点提供。

## 注意事项

- 当前 frontmatter 解析器覆盖了常见的字符串和数组写法，不是完整 YAML 解析器。
- 图谱数据在 VuePress 构建或开发服务准备阶段生成，修改 Markdown 后需要让 VuePress 重新构建或触发开发服务刷新。
- 悬浮按钮图标使用在线 Iconify 地址：`https://api.iconify.design/carbon/chart-relationship.svg`。
