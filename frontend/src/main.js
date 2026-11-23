import './style.css'

import { createApp, defineComponent, onBeforeUnmount, onMounted, ref } from 'vue'

const statusLabels = {
  CREATING: '创建中',
  STARTING: '启动中',
  READY: '运行中',
  STOPPING: '停止中',
  STOPPED: '已停止',
  FAILED: '失败',
  DESTROYED: '已销毁',
}

const statusFilters = [
  { key: 'ALL', label: '全部' },
  { key: 'READY', label: '运行中' },
  { key: 'STOPPED', label: '已停止' },
  { key: 'FAILED', label: '失败' },
  { key: 'DESTROYED', label: '已销毁' },
]

const app = defineComponent({
  setup() {
    const environments = ref([])
    const activeFilter = ref('ALL')
    const search = ref('')
    const apiConnected = ref(false)
    const searchInput = ref(null)
    const loading = ref(true)
    const refreshing = ref(false)
    const errorMessage = ref('')
    const createOpen = ref(false)
    const creating = ref(false)
    const newName = ref('')
    const pendingAction = ref('')
    const pendingDelete = ref(null)
    const toast = ref('')
    let toastTimer
    let refreshTimer

    const visibleEnvironments = () => {
      const query = search.value.trim().toLocaleLowerCase()
      return environments.value.filter((environment) => {
        const matchesFilter =
          activeFilter.value === 'ALL' ||
          environment.status === activeFilter.value
        const matchesSearch =
          !query ||
          environment.name.toLocaleLowerCase().includes(query) ||
          environment.id.toLocaleLowerCase().includes(query)
        return matchesFilter && matchesSearch
      })
    }

    const counts = () => ({
      total: environments.value.length,
      ready: environments.value.filter((item) => item.status === 'READY').length,
      stopped: environments.value.filter((item) => item.status === 'STOPPED').length,
      failed: environments.value.filter((item) => item.status === 'FAILED').length,
    })

    const notify = (message) => {
      toast.value = message
      window.clearTimeout(toastTimer)
      toastTimer = window.setTimeout(() => {
        toast.value = ''
      }, 3200)
    }

    const request = async (url, options) => {
      const response = await fetch(url, options)
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.detail || `请求失败（${response.status}）`)
      }
      return body
    }

    const loadEnvironments = async ({ quiet = false } = {}) => {
      if (!quiet) loading.value = true
      errorMessage.value = ''
      try {
        environments.value = await request('/api/environments')
        apiConnected.value = true
      } catch (error) {
        apiConnected.value = false
        errorMessage.value = error.message
      } finally {
        loading.value = false
        refreshing.value = false
      }
    }

    const checkApi = async () => {
      try {
        await request('/api/health')
        apiConnected.value = true
      } catch {
        apiConnected.value = false
      }
    }

    const refresh = () => {
      refreshing.value = true
      void Promise.all([loadEnvironments({ quiet: true }), checkApi()])
    }

    const createEnvironment = async () => {
      const name = newName.value.trim()
      if (!name || creating.value) return
      creating.value = true
      errorMessage.value = ''
      try {
        await request('/api/environments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        })
        createOpen.value = false
        newName.value = ''
        await loadEnvironments({ quiet: true })
        notify('环境已创建并通过服务检查')
      } catch (error) {
        errorMessage.value = error.message
      } finally {
        creating.value = false
      }
    }

    const performAction = async (environment, action) => {
      if (pendingAction.value) return
      const key = `${environment.id}:${action}`
      pendingAction.value = key
      errorMessage.value = ''
      try {
        if (action === 'destroy') {
          await request(`/api/environments/${environment.id}`, {
            method: 'DELETE',
          })
          pendingDelete.value = null
          notify(`“${environment.name}”已销毁`)
        } else {
          await request(`/api/environments/${environment.id}/${action}`, {
            method: 'POST',
          })
          notify(action === 'start' ? '环境已启动' : '环境已停止')
        }
        await loadEnvironments({ quiet: true })
      } catch (error) {
        errorMessage.value = error.message
      } finally {
        pendingAction.value = ''
      }
    }

    const formatDate = (value) => {
      if (!value) return '—'
      return new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(value))
    }

    const serviceHost = (url) => {
      if (!url) return '—'
      try {
        return new URL(url).host
      } catch {
        return url
      }
    }

    const handleSearchShortcut = (event) => {
      const target = event.target
      const isTyping =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      if (event.key !== '/' || isTyping) return
      event.preventDefault()
      searchInput.value?.focus()
    }

    onMounted(() => {
      void Promise.all([loadEnvironments(), checkApi()])
      refreshTimer = window.setInterval(() => {
        void loadEnvironments({ quiet: true })
        void checkApi()
      }, 15000)
      window.addEventListener('keydown', handleSearchShortcut)
    })

    onBeforeUnmount(() => {
      window.clearInterval(refreshTimer)
      window.clearTimeout(toastTimer)
      window.removeEventListener('keydown', handleSearchShortcut)
    })

    return {
      activeFilter,
      apiConnected,
      createEnvironment,
      createOpen,
      creating,
      counts,
      environmentLabel: (status) => statusLabels[status] || status,
      environments,
      errorMessage,
      formatDate,
      loading,
      newName,
      pendingAction,
      pendingDelete,
      refresh,
      refreshing,
      searchInput,
      search,
      serviceHost,
      statusFilters,
      toast,
      visibleEnvironments,
    }
  },
  template: `
    <div class="app-frame">
      <aside class="sidebar" aria-label="主导航">
        <a class="brand" href="/" aria-label="EnvPilot 首页">
          <span class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M7 9.5h8.5M7 16h18M16.5 22.5H25" />
              <circle cx="20" cy="9.5" r="2.5" />
              <circle cx="11" cy="22.5" r="2.5" />
            </svg>
          </span>
          <span class="brand-name">EnvPilot</span>
        </a>

        <div class="workspace-switcher">
          <span class="workspace-avatar" aria-hidden="true">L</span>
          <span class="workspace-copy">
            <span class="workspace-label">工作区</span>
            <span class="workspace-name">本地开发</span>
          </span>
        </div>

        <p class="nav-heading">资源管理</p>
        <nav class="nav-list">
          <a class="nav-item active" href="#environments" aria-current="page">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <rect x="3" y="3" width="14" height="5" rx="1" />
              <rect x="3" y="12" width="14" height="5" rx="1" />
              <path d="M6 5.5h.01M6 14.5h.01M9 5.5h5M9 14.5h5" />
            </svg>
            <span>环境管理</span>
          </a>
        </nav>

        <div class="sidebar-bottom">
          <div class="connection-note">
            <span class="connection-dot" :class="{ connected: apiConnected }"></span>
            <span>{{ apiConnected ? 'API 服务正常' : 'API 未连接' }}</span>
          </div>
        </div>
      </aside>

      <header class="topbar">
        <div class="breadcrumbs"><span>资源</span><span class="crumb-separator">/</span><strong>环境管理</strong></div>
        <div class="topbar-actions">
          <span class="engine-label">本地 Docker</span>
          <button class="icon-button refresh-button" type="button" aria-label="刷新环境列表" :disabled="refreshing" @click="refresh">
            <svg :class="{ spinning: refreshing }" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M16 7.5A6.2 6.2 0 0 0 5 5.6L3.5 7M4 3.5v3.7h3.7M4 12.5a6.2 6.2 0 0 0 11 1.9l1.5-1.4M16 16.5v-3.7h-3.7" />
            </svg>
          </button>
        </div>
      </header>

      <main id="environments" class="workspace">
        <div class="page-content">
          <section class="page-heading">
            <div>
              <h1>环境管理</h1>
              <p>创建并管理独立的 Docker 测试环境</p>
            </div>
            <button class="button button-primary create-button" type="button" @click="createOpen = true">
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
              <span>新建环境</span>
            </button>
          </section>

          <section class="summary-strip" aria-label="环境数量概览">
            <div class="summary-item">
              <span class="summary-label">全部环境</span>
              <strong class="summary-value">{{ counts().total }}</strong>
            </div>
            <div class="summary-item">
              <span class="summary-label">运行中</span>
              <strong class="summary-value"><span class="status-dot ready"></span>{{ counts().ready }}</strong>
            </div>
            <div class="summary-item">
              <span class="summary-label">已停止</span>
              <strong class="summary-value">{{ counts().stopped }}</strong>
            </div>
            <div class="summary-item">
              <span class="summary-label">异常环境</span>
              <strong class="summary-value" :class="{ 'value-negative': counts().failed > 0 }">{{ counts().failed }}</strong>
            </div>
          </section>

          <section class="environment-section" aria-labelledby="environment-list-title">
            <div class="section-heading">
              <div>
                <h2 id="environment-list-title">环境实例</h2>
                <span class="section-total">{{ environments.length }} 个环境</span>
              </div>
              <span class="last-updated">每 15 秒自动刷新</span>
            </div>

            <div class="filter-row">
              <div class="tabs" role="tablist" aria-label="按环境状态筛选">
                <button
                  v-for="filter in statusFilters"
                  :key="filter.key"
                  class="tab"
                  :class="{ selected: activeFilter === filter.key }"
                  type="button"
                  role="tab"
                  :aria-selected="activeFilter === filter.key"
                  @click="activeFilter = filter.key"
                >{{ filter.label }}<span v-if="filter.key === 'ALL'" class="tab-count">{{ counts().total }}</span></button>
              </div>
              <label class="search-field">
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.8" cy="8.8" r="5.8" /><path d="m13 13 4 4" /></svg>
                <input ref="searchInput" v-model="search" type="search" placeholder="搜索环境名称或 ID" aria-label="搜索环境名称或 ID" title="按 / 聚焦搜索" />
                <kbd>/</kbd>
              </label>
            </div>

            <div v-if="errorMessage" class="error-banner" role="alert">
              <span class="error-symbol" aria-hidden="true">!</span>
              <span>{{ errorMessage }}</span>
              <button class="text-button" type="button" @click="refresh">重试</button>
            </div>

            <div v-if="loading && environments.length === 0" class="loading-state" role="status">
              <span class="spinner"></span>
              <span>正在读取环境列表…</span>
            </div>

            <div v-else-if="visibleEnvironments().length === 0" class="empty-state">
              <div class="empty-visual" aria-hidden="true">
                <svg viewBox="0 0 112 72" fill="none">
                  <path d="M27 21.5h21M64 21.5h21M56 30v17M37.5 47h37" />
                  <rect x="13.5" y="12" width="27" height="19" rx="3" />
                  <rect x="71.5" y="12" width="27" height="19" rx="3" />
                  <rect x="42.5" y="43" width="27" height="19" rx="3" />
                  <circle cx="21" cy="21.5" r="1" /><circle cx="29" cy="21.5" r="1" />
                  <circle cx="79" cy="21.5" r="1" /><circle cx="87" cy="21.5" r="1" />
                  <circle cx="50" cy="52.5" r="1" /><circle cx="58" cy="52.5" r="1" />
                </svg>
              </div>
              <h3>{{ search || activeFilter !== 'ALL' ? '没有匹配的环境' : '还没有测试环境' }}</h3>
              <p>{{ search || activeFilter !== 'ALL' ? '试试其他名称或状态筛选。' : '创建一个独立环境，开始验证你的服务。' }}</p>
              <button v-if="!search && activeFilter === 'ALL'" class="button button-secondary" type="button" @click="createOpen = true">创建第一个环境</button>
              <button v-else class="text-button" type="button" @click="search = ''; activeFilter = 'ALL'">清除筛选</button>
            </div>

            <div v-else class="table-wrap">
              <table class="environment-table">
                <thead>
                  <tr>
                    <th class="name-column">环境</th>
                    <th>状态</th>
                    <th>服务地址</th>
                    <th class="created-column">创建时间</th>
                    <th class="actions-column"><span class="sr-only">操作</span></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="environment in visibleEnvironments()" :key="environment.id">
                    <td class="environment-name-cell">
                      <span class="environment-mark" aria-hidden="true">
                        <svg viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="14" height="5" rx="1" /><rect x="3" y="12" width="14" height="5" rx="1" /><path d="M6 5.5h.01M6 14.5h.01" /></svg>
                      </span>
                      <span class="environment-identity">
                        <strong>{{ environment.name }}</strong>
                        <span class="environment-id" :title="environment.id">{{ environment.id.slice(0, 8) }}…</span>
                      </span>
                    </td>
                    <td>
                      <span class="status-label" :class="'status-' + environment.status.toLowerCase()">
                        <span class="status-dot" :class="environment.status.toLowerCase()"></span>
                        {{ environmentLabel(environment.status) }}
                      </span>
                      <span v-if="environment.error" class="environment-error" :title="environment.error">{{ environment.error }}</span>
                    </td>
                    <td class="service-cell">
                      <a v-if="environment.service_url && environment.status === 'READY'" :href="environment.service_url" target="_blank" rel="noreferrer">
                        {{ serviceHost(environment.service_url) }}
                        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9 3h4v4M13 3 7 9" /><path d="M11 9v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3" /></svg>
                      </a>
                      <span v-else class="muted-value">{{ environment.service_url ? serviceHost(environment.service_url) : '—' }}</span>
                    </td>
                    <td class="date-cell">{{ formatDate(environment.created_at) }}</td>
                    <td class="row-actions">
                      <button
                        v-if="environment.status === 'STOPPED'"
                        class="row-action"
                        type="button"
                        :disabled="pendingAction !== ''"
                        @click="performAction(environment, 'start')"
                      >{{ pendingAction === environment.id + ':start' ? '启动中…' : '启动' }}</button>
                      <button
                        v-else-if="environment.status === 'READY'"
                        class="row-action"
                        type="button"
                        :disabled="pendingAction !== ''"
                        @click="performAction(environment, 'stop')"
                      >{{ pendingAction === environment.id + ':stop' ? '停止中…' : '停止' }}</button>
                      <button
                        v-if="environment.status !== 'DESTROYED'"
                        class="row-action row-action-danger"
                        type="button"
                        :disabled="pendingAction !== ''"
                        @click="pendingDelete = environment"
                      >销毁</button>
                      <span v-else class="muted-value">—</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="environments.length > 0 && !loading" class="table-footer">
              显示 {{ visibleEnvironments().length }} 个环境，共 {{ environments.length }} 个
            </div>
          </section>

          <footer class="page-footer">
            <span>EnvPilot · Docker 测试环境</span>
            <a href="/docs" target="_blank" rel="noreferrer">API 文档 <span aria-hidden="true">↗</span></a>
          </footer>
        </div>
      </main>

      <div v-if="createOpen" class="modal-backdrop" @click.self="!creating && (createOpen = false)" @keydown.esc="!creating && (createOpen = false)">
        <section class="modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
          <div class="modal-heading">
            <div>
              <h2 id="create-title">新建测试环境</h2>
              <p>创建一个独立的 Nginx 容器用于验证服务连通性。</p>
            </div>
            <button class="icon-button close-button" type="button" aria-label="关闭" :disabled="creating" @click="createOpen = false">
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
            </button>
          </div>
          <form @submit.prevent="createEnvironment">
            <label class="form-label" for="environment-name">环境名称</label>
            <input id="environment-name" v-model="newName" class="form-input" type="text" maxlength="80" placeholder="例如：订单回归测试" required autofocus />
            <p class="form-hint">最多 80 个字符。服务就绪后会分配本机随机端口。</p>
            <div v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</div>
            <div class="modal-actions">
              <button class="button button-secondary" type="button" :disabled="creating" @click="createOpen = false">取消</button>
              <button class="button button-primary" type="submit" :disabled="creating || !newName.trim()">
                <span v-if="creating" class="button-spinner"></span>
                {{ creating ? '正在创建…' : '创建环境' }}
              </button>
            </div>
            <p v-if="creating" class="creating-note">正在启动容器并检查服务是否可用，请稍候。</p>
          </form>
        </section>
      </div>

      <div v-if="pendingDelete" class="modal-backdrop" @click.self="pendingDelete = null" @keydown.esc="pendingDelete = null">
        <section class="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
          <div class="modal-heading">
            <div>
              <h2 id="delete-title">销毁此环境？</h2>
              <p>将停止并移除 <strong>{{ pendingDelete.name }}</strong> 对应的 Docker 容器。此操作无法撤销。</p>
            </div>
            <button class="icon-button close-button" type="button" aria-label="关闭" @click="pendingDelete = null">
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
            </button>
          </div>
          <div class="modal-actions">
            <button class="button button-secondary" type="button" @click="pendingDelete = null">取消</button>
            <button class="button button-danger" type="button" :disabled="pendingAction !== ''" @click="performAction(pendingDelete, 'destroy')">
              {{ pendingAction.endsWith(':destroy') ? '正在销毁…' : '确认销毁' }}
            </button>
          </div>
        </section>
      </div>

      <div v-if="toast" class="toast" role="status">{{ toast }}</div>
    </div>
  `,
})

createApp(app).mount('#app')
