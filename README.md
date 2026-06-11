# vuepress-plugin-knowledge-graph

一个用于 VuePress 2 的知识图谱插件。在构建阶段扫描 Markdown 文件，根据 Obsidian 风格双链、相对链接、标签和分类生成关系图，并在站点右下角提供可打开、可拖拽宽度的图谱侧边栏。

## 功能

- 自动扫描 VuePress 文档目录下的 `**/*.md`
- 支持 Obsidian 双链：`[[目标页面]]`、`[[目标页面|显示文本]]`、`[[目标页面#标题]]`
- 支持相对 Markdown 链接：`[标题](./目标页面.md)`
- 可选根据 `tags` / `tag` 建立标签关系边
- 可选根据 `categories` / `category` 建立分类关系边
- 右下角悬浮按钮打开图谱侧边栏
- 侧边栏可拖拽调整宽度
- 打开图谱时自动聚焦当前页面节点
- 双击节点跳转到对应页面
- 鼠标悬停时高亮关联节点与边

## 环境要求

| 依赖 | 版本 |
| --- | --- |
| Node.js | `^20.19.0` 或 `>=22.0.0` |
| VuePress | `^2.0.0-rc.30` |
| Vue | `^3.5.0` |

本插件不绑定特定主题，可与任意 VuePress 2 主题配合使用。

## 安装

```bash
npm install vuepress-plugin-knowledge-graph
# 或
pnpm add vuepress-plugin-knowledge-graph
# 或
yarn add vuepress-plugin-knowledge-graph
```

本地开发时：

```bash
npm install ../vuepress-plugin-knowledge-graph
```

## 快速开始

在 `.vuepress/config.ts` 中注册插件：

```typescript
import { defineUserConfig } from 'vuepress'
import { knowledgeGraphPlugin } from 'vuepress-plugin-knowledge-graph'

export default defineUserConfig({
  plugins: [
    knowledgeGraphPlugin(),
  ],
})
```

注册后，所有页面右下角会自动出现图谱按钮，**无需单独创建图谱页面**。

## 配置项

```typescript
knowledgeGraphPlugin({
  docsDir: '/absolute/path/to/docs',
  includeTagEdges: true,
  includeCategoryEdges: true,
})
```

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `docsDir` | `string` | VuePress `source` 目录 | Markdown 扫描根目录，通常无需手动设置 |
| `includeTagEdges` | `boolean` | `true` | 是否为相同标签的页面建立连接 |
| `includeCategoryEdges` | `boolean` | `true` | 是否为相同分类的页面建立连接 |

## 建立页面关系

### Obsidian 双链

```markdown
这篇文章关联到 [[另一篇笔记]]。
这篇文章也关联到 [[论文/Segment Anything|SAM 论文]]。
```

### 普通相对链接

```markdown
[查看相关笔记](./related.md)
```

### Frontmatter 标签与分类

```markdown
---
title: Segment Anything
tags: [vision, foundation-model]
categories: [paper]
---
```

相同 `tags` 或 `categories` 的页面会在图谱中通过对应类型的边连接（可在配置中关闭）。

## 在页面中嵌入完整图谱

除默认侧边栏外，可在任意 Markdown 页面插入完整图谱组件：

```markdown
<KnowledgeGraph />
```

## 交互说明

| 操作 | 效果 |
| --- | --- |
| 点击右下角按钮 | 打开 / 关闭图谱侧边栏 |
| 拖拽侧边栏左边缘 | 调整宽度 |
| 双击节点 | 跳转到对应页面 |
| 悬停节点 | 高亮该节点及其关联节点、边 |
| 打开侧边栏 | 自动聚焦当前页面节点 |

## 项目结构

```
vuepress-plugin-knowledge-graph/
├── index.js                              # npm 包 Node 入口
├── index.d.ts                            # 类型声明
├── src/
│   ├── node/
│   │   └── index.ts                      # 插件源码（构建时扫描 Markdown）
│   └── client/
│       ├── config.ts                     # 客户端配置
│       └── components/
│           ├── KnowledgeGraph.vue        # 图谱画布
│           └── KnowledgeGraphSidebar.vue # 右侧侧边栏
├── package.json
└── README.md
```

## 注意事项

- Frontmatter 解析器覆盖常见的字符串和数组写法，**不是完整 YAML 解析器**。
- 图谱数据在 VuePress 构建或开发服务准备阶段生成；修改 Markdown 后需等待 VuePress 重新编译或刷新。
- 悬浮按钮图标使用在线 Iconify 地址：`https://api.iconify.design/carbon/chart-relationship.svg`，离线环境可能无法显示图标，但不影响功能。

## 开发

在插件仓库中修改代码后，在使用方项目中刷新依赖并重启开发服务：

```bash
npm run docs:dev
```

发布前可检查将打入 npm 包的文件：

```bash
npm pack --dry-run
```

## 许可证

MIT
