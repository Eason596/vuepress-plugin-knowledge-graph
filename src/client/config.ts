import { defineClientConfig } from 'vuepress/client'
import KnowledgeGraph from './components/KnowledgeGraph.vue'
import KnowledgeGraphSidebar from './components/KnowledgeGraphSidebar.vue'

export default defineClientConfig({
  rootComponents: [
    KnowledgeGraphSidebar,
  ],
  enhance({ app }) {
    app.component('KnowledgeGraph', KnowledgeGraph)
  },
})
