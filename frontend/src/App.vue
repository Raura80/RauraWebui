<script setup lang="ts">
import { ref, provide, onMounted, onUnmounted, nextTick, watch } from 'vue'

// ======================== 组件导入 ========================
// 通用组件
import Toast from './components/common/Toast.vue'
import ImageModal from './components/common/ImageModal.vue'
import LivePreview from './components/output/LivePreview.vue'
import HeroSection from './components/common/HeroSection.vue'

// 浮层组件
import TagDetailTooltip from './components/floating/TagDetailTooltip.vue'
import TagSuggestions from './components/floating/TagSuggestions.vue'
import PresetSuggestions from './components/floating/PresetSuggestions.vue'
import PresetPreviewBox from './components/floating/PresetPreviewBox.vue'

// 设置组件
import PromptInput from './components/settings/PromptInput.vue'
import ModelSelect from './components/settings/ModelSelect.vue'
import LoraConfig from './components/settings/LoraConfig.vue'
import RatioSlider from './components/settings/RatioSlider.vue'
import AdvancedSettings from './components/settings/AdvancedSettings.vue'

// 输出组件
import GenerateButton from './components/output/GenerateButton.vue'
import ResultArea from './components/output/ResultArea.vue'
import HistoryPanel from './components/output/HistoryPanel.vue'

// 搜索弹窗组件
import TagSearchPopup from './components/search/TagSearchPopup.vue'
import ArtistSearchPopup from './components/search/ArtistSearchPopup.vue'
import RelatedTagsPopup from './components/search/RelatedTagsPopup.vue'

// ======================== Composable 导入 ========================
import { useWebSocket } from './composables/useWebSocket'
import { useTheme } from './composables/useTheme'
import { useClientIdentity } from './composables/useClientIdentity'
import { useTagSuggestions } from './composables/useTagSuggestions'
import { useHistory } from './composables/useHistory'
import type { RestoreCallbacks } from './composables/useHistory'
import { usePresets } from './composables/usePresets'
import { useGeneration } from './composables/useGeneration'
import { useAdvancedSettings } from './composables/useAdvancedSettings'
import { useLoraConfig } from './composables/useLoraConfig'

// ======================== 工具函数导入 ========================
import { decryptTagData } from './utils/crypto'
import { autoResizeTextarea } from './utils/helpers'
import { calculateSliderValueFromResolution } from './utils/resolution'
import { STORAGE_KEY_PREFIX } from './utils/constants'

// ======================== API 导入 ========================
import { getQuota } from './services/api'

// ======================== Pinia Store 导入 ========================
import { useGenerationStore } from './stores/generation'
import { useModelsStore } from './stores/models'
import { useTagsStore } from './stores/tags'
import { useUserStore } from './stores/user'

// ======================== 类型导入 ========================
import type { TagItem, ArtistItem, PresetItem } from './types'

// ======================== Store 实例化 ========================
const generationStore = useGenerationStore()
const modelsStore = useModelsStore()
const tagsStore = useTagsStore()
const userStore = useUserStore()

// ======================== Toast 全局方法 ========================
const toastMessage = ref('')
const toastType = ref<'success' | 'error' | 'warning' | 'info'>('info')
const toastVisible = ref(false)

/** 显示 Toast 提示，供子组件通过 inject('showToast') 调用 */
function showToast(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') {
  toastMessage.value = message
  toastType.value = type
  toastVisible.value = true
  // 6 秒后自动隐藏
  setTimeout(() => {
    toastVisible.value = false
  }, 6000)
}

// ======================== Composable 实例化 ========================
// App.vue 自身使用的 composables
const websocket = useWebSocket()
const theme = useTheme()
const clientIdentity = useClientIdentity()
const generation = useGeneration(showToast as (msg: string, type: 'success' | 'error' | 'warning') => void)
const advSettings = useAdvancedSettings()
const loraConfig = useLoraConfig()

// 共享 composables —— 通过 provide 提供给子组件
const tagSuggestions = useTagSuggestions()
const history = useHistory()
const presets = usePresets()

// ======================== Provide 共享实例 ========================
provide('tagSuggestions', tagSuggestions)
provide('history', history)
provide('presets', presets)
provide('generation', generation)
provide('advSettings', advSettings)
provide('showToast', showToast)

// ======================== 历史记录参数恢复回调 ========================
history.setRestoreCallbacks({
  setPrompt: (text: string) => {
    if (promptInputRef.value) {
      promptInputRef.value.promptText = text
      nextTick(() => {
        if (promptInputRef.value?.textareaRef) {
          autoResizeTextarea(promptInputRef.value.textareaRef)
        }
      })
    }
  },
  setNegativePrompt: (text: string) => {
    advSettings.negativePrompt.value = text
  },
  setSeed: (value: number) => {
    advSettings.seed.value = value
    generationStore.isSeedManuallySet = true
  },
  updateAdvancedParams: (params: Record<string, any>) => {
    advSettings.updateUIFromParams(params)
  },
  setResolution: (width: number, height: number) => {
    if (ratioSliderRef.value) {
      const sliderVal = calculateSliderValueFromResolution(width, height)
      ratioSliderRef.value.sliderValue = sliderVal
      ratioSliderRef.value.ratioSlider.updateState(sliderVal)
    }
  },
} as RestoreCallbacks)

// ======================== 标签联想浮层状态 ========================
const suggestionsPosition = ref({ top: 0, left: 0 })

// ======================== 预设候选浮层状态 ========================
const presetSuggestionsVisible = ref(false)
const presetSuggestionsList = ref<PresetItem[]>([])
const presetSuggestionsPosition = ref({ top: 0, left: 0 })
const presetSearchQuery = ref('')

// ======================== 标签详情浮窗状态 ========================
// 注意：当前 TagDetailTooltip 的内容由 useTagSearchPopup 通过 DOM 直接操作，
// 以下 ref 作为 prop 传递但未被主动更新，保留以维持组件接口兼容
const tagDetailTooltipVisible = ref(false)
const tagDetailTooltipTag = ref('')
const tagDetailTooltipWiki = ref('')
const tagDetailTooltipCategory = ref('')

// ======================== 预设预览图框状态 ========================
// 注意：当前 PresetPreviewBox 由 PresetSuggestions 内部自行管理，
// 以下 ref 作为 prop 传递但未被主动更新，保留以维持组件接口兼容
const presetPreviewVisible = ref(false)
const presetPreviewImageSrc = ref('')
const presetPreviewPosition = ref({ top: 0, left: 0 })

// ======================== 加载页面状态 ========================
const loadingVisible = ref(true)
// 加载进度百分比（传递给 HeroSection 的 CTA 按钮）
const loadingProgress = ref(0)
// ComfyUI 是否已连接（WebSocket 状态通道连通即代表 ComfyUI 可达）
const comfyuiConnected = ref(false)

// ======================== 子组件 ref ========================
const promptInputRef = ref<InstanceType<typeof PromptInput> | null>(null)
const tagSearchPopupRef = ref<InstanceType<typeof TagSearchPopup> | null>(null)
const artistSearchPopupRef = ref<InstanceType<typeof ArtistSearchPopup> | null>(null)
const ratioSliderRef = ref<InstanceType<typeof RatioSlider> | null>(null)

// ======================== WebSocket ↔ Generation 联动 ========================
// 监听 WebSocket 连接状态，同步到 comfyuiConnected
watch(() => websocket.isStatusConnected.value, (connected) => {
  comfyuiConnected.value = connected
  // 加载已完成且 ComfyUI 刚连上 → 解锁页面滚动
  if (connected && !loadingVisible.value) {
    document.body.style.overflow = ''
  }
})

// 监听 WebSocket 进度数据，更新生成按钮进度
watch(() => websocket.progressData.value, (data) => {
  if (data) generation.updateProgress(data)
})

// 监听 WebSocket 队列状态，更新生成按钮队列显示
watch(() => websocket.queueData.value, (data) => {
  if (data) generation.updateQueueStatus(data)
})

// 监听 WebSocket 任务失败消息
watch(() => websocket.taskFailedMessage.value, (msg) => {
  if (msg) {
    showToast(msg, 'error')
    generation.fetchUserQuota()
  }
})

// 监听 generationStore 的 outputFilename，触发 fetchResult 获取成品图
watch(() => generationStore.outputFilename, (filename) => {
  if (filename) {
    generation.fetchResult(filename, generationStore.currentPromptId ?? undefined)
  }
})

// 监听模型切换，同步更新高级设置参数
watch(() => modelsStore.selectedModelParams, (params) => {
  if (params) {
    advSettings.updateUIFromParams(params)
  }
})


// ======================== PromptInput 事件处理 ========================

/** 标签搜索按钮点击 */
function onTagSearch() {
  tagSearchPopupRef.value?.togglePopup()
}

/** 预设按钮点击（原版逻辑：基于按钮位置计算弹窗位置） */
function onPreset() {
  // 从 userStore.dbPresets 构建预设列表
  const dbPresets = userStore.dbPresets
  const list: PresetItem[] = Object.entries(dbPresets).map(([name, data]) => ({
    uuid: data.uuid,
    name,
    prompt: data.prompt,
    params: data.params,
    has_image: false,
    is_public: data.is_public || 0,
    created_at: data.created_at,
  }))
  presetSuggestionsList.value = list
  presetSearchQuery.value = ''

  // 计算位置：基于预设按钮的位置（使用 fixed 定位，不需要加 scrollTop/scrollLeft）
  const presetBtn = document.getElementById('presetBtn')
  if (presetBtn) {
    const btnRect = presetBtn.getBoundingClientRect()
    const windowWidth = window.innerWidth
    const isMobile = windowWidth <= 768
    if (isMobile) {
      let topPos = btnRect.bottom + 5
      let leftPos = btnRect.right - 280 // 预设面板宽度约 280
      if (leftPos < 10) leftPos = 10
      presetSuggestionsPosition.value = { top: topPos, left: leftPos }
    } else {
      // 桌面端：弹窗在按钮右侧
      let leftPos = btnRect.right + 10
      let topPos = btnRect.top - 10
      if (leftPos + 280 > windowWidth) leftPos = btnRect.left - 280 - 10
      presetSuggestionsPosition.value = { top: topPos, left: leftPos }
    }
  }

  presetSuggestionsVisible.value = true
}

/** 画师搜索按钮点击 */
function onArtistSearch() {
  artistSearchPopupRef.value?.togglePopup()
}

// ======================== LoRA 触发词处理 ========================
/** 添加 LoRA 时，将触发词插入提示词 */
function onLoraAddTrigger(triggerWord: string) {
  if (!triggerWord || !promptInputRef.value) return
  const currentPrompt = promptInputRef.value.promptText
  const newPrompt = loraConfig.updatePromptWithTrigger('', triggerWord, currentPrompt)
  if (newPrompt !== currentPrompt) {
    promptInputRef.value.promptText = newPrompt
  }
}

/** 删除 LoRA 时，从提示词中移除触发词 */
function onLoraRemoveTrigger(triggerWord: string) {
  if (!triggerWord || !promptInputRef.value) return
  const currentPrompt = promptInputRef.value.promptText
  const newPrompt = loraConfig.updatePromptWithTrigger(triggerWord, '', currentPrompt)
  if (newPrompt !== currentPrompt) {
    promptInputRef.value.promptText = newPrompt
  }
}

/** 切换 LoRA 时，替换提示词中的触发词 */
function onLoraUpdateTrigger(oldTrigger: string, newTrigger: string) {
  if (!promptInputRef.value) return
  const currentPrompt = promptInputRef.value.promptText
  const newPrompt = loraConfig.updatePromptWithTrigger(oldTrigger, newTrigger, currentPrompt)
  if (newPrompt !== currentPrompt) {
    promptInputRef.value.promptText = newPrompt
  }
}

/** 标签联想位置更新（由 PromptInput 的 onInput 事件触发） */
function onSuggestionsPosition(position: { top: number; left: number }) {
  suggestionsPosition.value = position
}

// ======================== 生成按钮事件处理 ========================
/** 生成按钮点击 —— 收集所有参数并触发生图流程 */
function onGenerate() {
  // 获取提示词
  const positivePrompt = promptInputRef.value?.promptText ?? ''

  // 获取高级参数
  const advancedOptions = {
    seed: advSettings.seed.value,
    steps: advSettings.steps.value,
    cfg: advSettings.cfg.value,
    samplerName: advSettings.samplerName.value,
    scheduler: advSettings.scheduler.value,
    denoise: advSettings.denoise.value,
    clipSkip: advSettings.clipSkip.value,
    negativePrompt: advSettings.negativePrompt.value,
  }

  // 获取分辨率
  const resolution = ratioSliderRef.value?.ratioSlider.getCurrentResolution() ?? { width: 1024, height: 1280 }

  // 触发生成
  generation.generateImage(
    positivePrompt,
    advancedOptions,
    resolution,
    () => websocket.isStatusWsReady(),
    () => websocket.initStatusWs(),
  )
}

// ======================== 预设候选选择 ========================
function onPresetSelect(preset: PresetItem) {
  // 1. 将预设提示词填入输入框
  if (promptInputRef.value) {
    promptInputRef.value.promptText = preset.prompt
    nextTick(() => {
      if (promptInputRef.value?.textareaRef) {
        autoResizeTextarea(promptInputRef.value.textareaRef)
      }
    })
  }

  // 2. 恢复预设中的所有参数
  const params = preset.params
  if (params) {
    // 恢复模型选择
    // 优先使用 model_display_name 直接匹配 modelsConfig 中的模型 name（key）
    if (params.model_display_name) {
      const displayName = params.model_display_name
      const config = modelsStore.modelsConfig
      let found = false
      if (config) {
        for (const [category, group] of Object.entries(config)) {
          // group.models 的 key 就是模型的 name，与 model_display_name 对应
          if (group.models && displayName in group.models) {
            const modelData = group.models[displayName]
            const filename = typeof modelData === 'string' ? modelData : (modelData as any).filename
            modelsStore.selectedModelFilename = filename
            modelsStore.selectedModelDisplayName = displayName
            modelsStore.currentStyleCategory = category
            if (typeof modelData !== 'string') {
              modelsStore.selectedModelParams = (modelData as any).params || {}
              modelsStore.selectedClipName = (modelData as any).clip || ''
              modelsStore.selectedVaeName = (modelData as any).vae || ''
            }
            found = true
            break
          }
        }
      }
      // 回退：用 ckpt_name 匹配文件名
      if (!found && params.ckpt_name) {
        const normalizedCkpt = params.ckpt_name.replace(/\\\\/g, '\\')
        if (config) {
          for (const [category, group] of Object.entries(config)) {
            for (const [name, modelData] of Object.entries(group.models)) {
              const filename = typeof modelData === 'string' ? modelData : (modelData as any).filename
              if (filename === normalizedCkpt) {
                modelsStore.selectedModelFilename = filename
                modelsStore.selectedModelDisplayName = name
                modelsStore.currentStyleCategory = category
                if (typeof modelData !== 'string') {
                  modelsStore.selectedModelParams = (modelData as any).params || {}
                  modelsStore.selectedClipName = (modelData as any).clip || ''
                  modelsStore.selectedVaeName = (modelData as any).vae || ''
                  modelsStore.selectedModelQuotaCost = (modelData as any).quota_cost ?? 1
                }
                found = true
                break
              }
            }
            if (found) break
          }
        }
        if (!found) {
          modelsStore.selectedModelFilename = normalizedCkpt
        }
      }
    }

    // 恢复高级参数（steps, cfg, sampler, scheduler, denoise, clip_skip, negative_prompt）
    advSettings.updateUIFromParams({
      steps: params.steps,
      cfg: params.cfg,
      sampler: params.sampler_name,
      scheduler: params.scheduler,
      denoise: params.denoise,
      clip_skip: params.clip_skip,
      negative_prompt: params.negative_prompt,
    })

    // 恢复 LoRA 列表
    // 预设中 lora.name 是文件路径，需要从 loraConfig 中查找对应的显示名
    if (params.lora_list && params.lora_list.length > 0) {
      const loraConfig = modelsStore.loraConfig || {}
      modelsStore.loraRows = params.lora_list.map((lora: { name: string; strength: number }) => {
        // 统一反斜杠
        const loraFilename = lora.name.replace(/\\\\/g, '\\')
        // 从 loraConfig 中查找显示名：key 是显示名，value.filename 是文件路径
        let displayName = loraFilename
        let triggerWord = ''
        let quotaCost = 0
        for (const [name, info] of Object.entries(loraConfig)) {
          if (info.filename === loraFilename) {
            displayName = name
            triggerWord = info.trigger || ''
            quotaCost = info.quota_cost ?? 0
            break
          }
        }
        return {
          id: `lora-row-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          filename: loraFilename,
          displayName,
          strength: lora.strength,
          triggerWord,
          quotaCost,
        }
      })
    } else {
      modelsStore.loraRows = []
    }

    // 恢复分辨率（反推滑块值，通过 ratioSliderRef 更新 UI）
    if (params.width && params.height && ratioSliderRef.value) {
      const sliderVal = calculateSliderValueFromResolution(params.width, params.height)
      ratioSliderRef.value.sliderValue = sliderVal
      ratioSliderRef.value.ratioSlider.updateState(sliderVal)
    }
  }

  presetSuggestionsVisible.value = false
}

// ======================== 标签联想选择 ========================
function onTagSuggestionSelect(tag: TagItem) {
  // defineExpose 暴露的 ref 会自动解包，textareaRef 直接是 DOM 元素
  const textareaEl = promptInputRef.value?.textareaRef as HTMLTextAreaElement | null | undefined
  if (textareaEl) {
    const result = tagSuggestions.selectSuggestion(tag, textareaEl)
    promptInputRef.value!.promptText = result.newValue
    nextTick(() => {
      textareaEl.focus()
      textareaEl.setSelectionRange(result.newCursorPos, result.newCursorPos)
    })
  }
}

/** 标签联想导航（上下键） */
function onTagSuggestionNavigate(index: number) {
  tagSuggestions.setSelectedSuggestion(index)
}

// ======================== 图片模态窗事件 ========================
function onModalClose() {
  history.closeImageModal()
}

function onModalNavigate(direction: number) {
  history.navigateModalHistory(direction)
}

// ======================== 主题切换 ========================
function onThemeToggle() {
  theme.switchTheme()
}

// ======================== onMounted 初始化流程 ========================
onMounted(async () => {
  // 0. 加载期间锁定页面滚动
  document.body.style.overflow = 'hidden'

  // 1. 启动加载进度动画
  const progressInterval = setInterval(() => {
    loadingProgress.value += Math.random() * 3
    if (loadingProgress.value >= 100) {
      loadingProgress.value = 100
      clearInterval(progressInterval)
    }
  }, 200)

  try {
    // 2. 初始化客户端身份
    await clientIdentity.initClientId()

    // 3. 初始化主题
    theme.initTheme()

    // 4. 加载词库数据（并行 fetch ta.dat 和 ar.dat）
    const [tagRes, artistRes] = await Promise.all([
      fetch('/ta.dat').catch(() => null),
      fetch('/ar.dat').catch(() => null),
    ])

    let tagData: TagItem[] = []
    let artistsData: ArtistItem[] = []

    // 解密标签数据
    if (tagRes && tagRes.ok) {
      const tagText = await tagRes.text()
      const decrypted = decryptTagData(tagText)
      if (decrypted) tagData = decrypted
    }

    // 解密画师数据并转换为标签格式
    if (artistRes && artistRes.ok) {
      const artistText = await artistRes.text()
      const decrypted = decryptTagData(artistText)
      if (decrypted) {
        artistsData = decrypted
        // 将画师数据转换为标签格式并合并到 tagData
        const getVisualLength = (str: string): number => {
          let len = 0
          for (let i = 0; i < str.length; i++) len += str.charCodeAt(i) > 127 ? 2 : 1
          return len
        }
        const artistTags: TagItem[] = artistsData.map((a: ArtistItem) => {
          let cnName = ''
          if (a.other_names && a.other_names.length > 0) {
            const namesToJoin = a.other_names.slice(0, 2)
            const rawJoined = namesToJoin.join(', ')
            const MAX_VISUAL_WIDTH = 24
            if (getVisualLength(rawJoined) > MAX_VISUAL_WIDTH) {
              let tempName = ''
              let currentWidth = 0
              for (const char of rawJoined) {
                const charWidth = char.charCodeAt(0) > 127 ? 2 : 1
                if (currentWidth + charWidth > MAX_VISUAL_WIDTH - 2) break
                tempName += char
                currentWidth += charWidth
              }
              cnName = tempName + '...'
            } else {
              cnName = rawJoined
            }
          }
          return {
            tag: a.name,
            'right tag cn': cnName ? `艺术家: ${cnName}` : '艺术家',
            pinyin: '',
            count: a.post_count,
            is_artist: true,
          }
        })
        tagData = tagData.concat(artistTags)
      }
    }

    // 将数据写入 tagsStore
    tagsStore.setTagData(tagData)
    tagsStore.setArtistsData(artistsData)
    tagsStore.buildTagDict()
    tagsStore.loadTagUsageFrequency()
    tagsStore.loadArtistStars()
    tagsStore.setLoaded(true)

    // 5. 初始化 WebSocket
    websocket.initStatusWs()

    // 6. 加载预设
    await presets.initPresetButton()

    // 7. 加载历史记录（从 IndexedDB 恢复，页面刷新后图片仍可用）
    await history.loadHistory()

    // 8. 加载额度
    if (userStore.clientId) {
      try {
        const quotaData = await getQuota(userStore.clientId)
        userStore.setQuota(quotaData.quota)
      } catch (e) {
      }
    }

    // 9. 恢复提示词：从 localStorage 读取对应分类的提示词
    const currentCategory = modelsStore.currentStyleCategory || 'anime'
    if (promptInputRef.value) {
      if (currentCategory === 'anime') {
        const saved = localStorage.getItem(`${STORAGE_KEY_PREFIX}anime_prompt`)
        promptInputRef.value.promptText = saved || ''
      } else {
        const saved = localStorage.getItem(`${STORAGE_KEY_PREFIX}realistic_prompt`)
        promptInputRef.value.promptText = saved || ''
      }
      nextTick(() => {
        if (promptInputRef.value?.textareaRef) {
          autoResizeTextarea(promptInputRef.value.textareaRef)
        }
      })
    }
  } catch (error) {
  }

  // 10. 加载完成，根据 ComfyUI 连接状态决定是否解锁滚动
  clearInterval(progressInterval)
  loadingProgress.value = 100
  setTimeout(() => {
    loadingVisible.value = false
    // ComfyUI 已连接才解锁滚动，否则保持锁定（用户停留在 hero 页）
    if (comfyuiConnected.value) {
      document.body.style.overflow = ''
    }
  }, 300)

  // ======================== 全局快捷键注册 ========================
  // Ctrl+Enter → 触发生成
  document.addEventListener('keydown', handleGlobalKeydown)

  // ======================== 页面关闭时断开 WebSocket ========================
  window.addEventListener('beforeunload', handleBeforeUnload)

  // ======================== 点击外部关闭预设面板 ========================
  document.addEventListener('click', handleOutsideClick)
})

// ======================== 全局快捷键处理 ========================
function handleGlobalKeydown(e: KeyboardEvent) {
  // Ctrl+Enter → 触发生成
  if (e.ctrlKey && e.key === 'Enter') {
    // 通过 generationStore 触发生成（具体逻辑由 GenerateButton 组件处理）
    // 这里 dispatch 自定义事件，让 GenerateButton 响应
    document.dispatchEvent(new CustomEvent('global-generate'))
    return
  }

  // Escape → 关闭图片模态窗
  if (e.key === 'Escape') {
    if (history.isModalVisible.value) {
      history.closeImageModal()
      return
    }
  }

  // 模态窗打开时的快捷键
  if (history.isModalVisible.value) {
    if (e.key === 'ArrowLeft') {
      history.navigateModalHistory(-1)
      return
    }
    if (e.key === 'ArrowRight') {
      history.navigateModalHistory(1)
      return
    }
    // Shift+Space → 关闭模态窗
    if (e.key === ' ' && e.shiftKey) {
      e.preventDefault()
      history.closeImageModal()
      return
    }
  } else {
    // 模态窗关闭时：Shift+Space → 打开模态窗
    if (e.key === ' ' && e.shiftKey) {
      e.preventDefault()
      if (generationStore.currentImageUrl) {
        history.showImageModal(generationStore.currentImageUrl)
      } else if (generationStore.imageHistory.length > 0) {
        const firstItem = generationStore.imageHistory[0] as any
        history.showImageModal(firstItem.filename ? `/api/view?filename=${encodeURIComponent(firstItem.filename)}` : '')
      }
      return
    }

    // 非输入框时：ArrowLeft/Right → 行内导航
    const activeTag = document.activeElement?.tagName || ''
    if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        history.navigateInlineHistory(-1)
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        history.navigateInlineHistory(1)
        return
      }
    }
  }
}

// ======================== 页面关闭处理 ========================
function handleBeforeUnload() {
  websocket.disconnect()
}

// ======================== 点击外部关闭预设面板 ========================
function handleOutsideClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const presetBtn = document.getElementById('presetBtn')
  const presetSuggestions = document.getElementById('presetSuggestions')
  if (presetBtn && presetSuggestions && !presetBtn.contains(target) && !presetSuggestions.contains(target)) {
    presetSuggestionsVisible.value = false
  }
}

// ======================== 组件卸载清理 ========================
onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('beforeunload', handleBeforeUnload)
  document.removeEventListener('click', handleOutsideClick)
})
</script>

<template>
  <!-- 全局背景层：5 个独立浮动光斑，各自节奏 -->
  <div class="background-layer">
    <div class="bg-blob bg-blob-1"></div>
    <div class="bg-blob bg-blob-2"></div>
    <div class="bg-blob bg-blob-3"></div>
    <div class="bg-blob bg-blob-4"></div>
    <div class="bg-blob bg-blob-5"></div>
  </div>

  <!-- 标签联想浮层 -->
  <TagSuggestions :suggestions="[...tagSuggestions.currentSuggestions.value]"
    :visible="tagSuggestions.isSuggestionsVisible.value" :position="suggestionsPosition"
    :active-index="tagSuggestions.selectedSuggestionIndex.value" @select="onTagSuggestionSelect"
    @navigate="onTagSuggestionNavigate" />

  <!-- 预设候选浮层 -->
  <PresetSuggestions :presets="presetSuggestionsList" :visible="presetSuggestionsVisible"
    :position="presetSuggestionsPosition" :search-query="presetSearchQuery" @select="onPresetSelect" />

  <!-- 标签详情浮窗 -->
  <TagDetailTooltip :visible="tagDetailTooltipVisible" :tag="tagDetailTooltipTag" :wiki="tagDetailTooltipWiki"
    :category="tagDetailTooltipCategory" />

  <!-- 标签搜索弹窗 -->
  <TagSearchPopup ref="tagSearchPopupRef" />

  <!-- 关联词弹窗 -->
  <RelatedTagsPopup ref="relatedTagsPopupRef" />

  <!-- 画师搜索弹窗 -->
  <ArtistSearchPopup ref="artistSearchPopupRef" />

  <!-- 主应用容器 -->
  <div class="main-container">
    <!-- Hero 区域（含主题切换按钮），加载时 CTA 按钮显示进度 -->
    <HeroSection :loading="loadingVisible" :loading-progress="loadingProgress" :comfyui-connected="comfyuiConnected">
      <template #theme-toggle>
        <button class="theme-toggle-btn" id="themeToggleBtn" title="切换主题" @click="onThemeToggle">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"
            stroke-linecap="round" stroke-linejoin="round">
            <polygon
              points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2">
            </polygon>
          </svg>
        </button>
      </template>
    </HeroSection>

    <!-- 创作工作区 -->
    <div id="workspace">
      <div class="content-wrapper">
        <!-- 左侧：创作设置模块 -->
        <div class="module settings-module">
          <h2 class="module-title">
            <svg class="ui-icon" viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2"
              fill="none">
              <circle cx="12" cy="12" r="3"></circle>
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z">
              </path>
            </svg>
            设置
            <AdvancedSettings />
          </h2>

          <PromptInput ref="promptInputRef" @tag-search="onTagSearch" @preset="onPreset" @artist-search="onArtistSearch"
            @suggestions-position="onSuggestionsPosition" />

          <ModelSelect />

          <LoraConfig @add-trigger="onLoraAddTrigger" @remove-trigger="onLoraRemoveTrigger"
            @update-trigger="onLoraUpdateTrigger" />

          <RatioSlider ref="ratioSliderRef" />
        </div>

        <!-- 右侧：出图模块与历史 -->
        <div class="module output-module" id="outputModule">
          <GenerateButton @generate="onGenerate" />
          <ResultArea />
          <HistoryPanel />
        </div>
      </div>
    </div>

    <!-- Toast 提示 -->
    <Toast :message="toastMessage" :type="toastType" v-if="toastVisible" />
  </div>

  <!-- 图片全屏模态窗 -->
  <ImageModal :visible="history.isModalVisible.value" :image-url="history.modalImageUrl.value" @close="onModalClose"
    @navigate="onModalNavigate" />

  <!-- 预设预览图框 -->
  <PresetPreviewBox :visible="presetPreviewVisible" :image-src="presetPreviewImageSrc"
    :position="presetPreviewPosition" />

  <!-- 实时预览浮层（必须放在根层级，因为 .module 有 backdrop-filter 会导致 fixed 定位失效） -->
  <LivePreview />
</template>
