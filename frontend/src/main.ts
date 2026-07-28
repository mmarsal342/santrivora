import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './offline/db'
import { initSyncEngine } from './offline/sync/engine'
import './style.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
initSyncEngine()
app.mount('#app')