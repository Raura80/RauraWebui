import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './assets/styles/original.css'
import App from './App.vue'

const app = createApp(App)

// 全局错误处理：防止未捕获的 Vue 组件错误导致白屏
app.config.errorHandler = (err, _instance, info) => {
    console.error('[全局错误]', info, err)
}

app.use(createPinia())
app.mount('#app')
