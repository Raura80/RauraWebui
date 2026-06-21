<script setup lang="ts">
/**
 * 生成按钮组件
 * 包含多状态按钮（idle/queued/progress/completed/cancel）、
 * 终止按钮、额度显示与兑换弹窗、提示气泡
 */
import { ref, computed, onMounted, onUnmounted, inject } from 'vue'
import { useGeneration } from '../../composables/useGeneration'
import { useTooltip } from '../../composables/useTooltip'
import { useModelsStore } from '../../stores/models'
import { useUserStore } from '../../stores/user'
import { redeemToken, ApiError } from '../../services/api'
import LightningIcon from '../common/LightningIcon.vue'

const modelsStore = useModelsStore()
const userStore = useUserStore()

// 通过 inject 获取 App.vue 提供的共享 generation 实例（避免多个独立实例导致状态不一致）
type GenerationReturn = ReturnType<typeof useGeneration>
const generation = inject<GenerationReturn>('generation')!

// 注意：inject 返回的普通对象中的 ref 在模板中不会自动解包，
// 需要用 computed 显式解包，否则模板中会显示 [object Object]
const buttonText = computed(() => generation.buttonText.value)
const buttonClass = computed(() => generation.buttonClass.value)
const buttonDisabled = computed(() => generation.buttonDisabled.value)
const progressWidth = computed(() => generation.progressWidth.value)
const handleGenerateClick = generation.handleGenerateClick
const fetchUserQuota = generation.fetchUserQuota
const showToast = generation.showToast

const { initTooltipBubble, removeDailyGiftCode, cleanup: cleanupTooltip } = useTooltip()

// 兑换弹窗显示状态
const isRedeemPopupVisible = ref(false)

// 兑换码输入
const redeemTokenValue = ref('')

// 兑换中状态
const isRedeeming = ref(false)

// 额度值（从 store 获取）
const quotaValue = computed(() => userStore.quota)

// 当前总点数消耗（模型 + LoRA）
const currentModelCost = computed(() => {
    const modelCost = modelsStore.selectedModelQuotaCost
    const loraCost = modelsStore.loraRows.reduce((sum, row) => sum + row.quotaCost, 0)
    return modelCost + loraCost
})

// 按钮是否处于空闲态（显示"运行"文本时）
const isIdleState = computed(() => buttonText.value === '运行')

// 按钮进度条样式
const btnStyle = computed(() => ({
    '--progress-width': progressWidth.value,
}))

// 额度定时刷新定时器
let quotaRefreshTimer: ReturnType<typeof setInterval> | null = null

// 点击生成按钮
function onGenerateClick() {
    handleGenerateClick(() => {
        // 实际生成逻辑由父组件通过 emit 触发
        emit('generate')
    })
}

// 全局快捷键触发的生成事件处理
function handleGlobalGenerate() {
    onGenerateClick()
}

// 切换兑换弹窗
function toggleRedeemPopup() {
    isRedeemPopupVisible.value = !isRedeemPopupVisible.value
    if (isRedeemPopupVisible.value) {
        redeemTokenValue.value = ''
    }
}

// 关闭兑换弹窗
function closeRedeemPopup() {
    isRedeemPopupVisible.value = false
}

// 提交兑换码
async function handleRedeem() {
    if (!redeemTokenValue.value.trim() || isRedeeming.value) return
    isRedeeming.value = true
    try {
        const result = await redeemToken({ client_id: userStore.clientId!, token_code: redeemTokenValue.value.trim() })
        if (result.success) {
            showToast(`兑换成功！获得 ${result.quota_added ?? 0} 点数，当前: ${result.new_quota ?? userStore.quota}`, 'success')
            fetchUserQuota()
            closeRedeemPopup()
            // 如果使用的是每日赠礼兑换码，从轮播中移除
            removeDailyGiftCode()
        } else {
            showToast(result.message || '兑换失败', 'error')
        }
    } catch (e) {
        const msg = e instanceof ApiError ? e.message : '兑换失败'
        showToast(msg, 'error')
    } finally {
        isRedeeming.value = false
    }
}

// 点击外部关闭兑换弹窗
function handleDocumentClick(e: MouseEvent) {
    const target = e.target as HTMLElement
    if (!target.closest('.generate-button-wrapper') && !target.closest('.quota-btn-wrapper')) {
        isRedeemPopupVisible.value = false
    }
}

const emit = defineEmits<{
    generate: []
}>()

onMounted(() => {
    initTooltipBubble()
    fetchUserQuota()
    document.addEventListener('click', handleDocumentClick)
    // 监听 Ctrl+Enter 全局快捷键触发的自定义事件
    document.addEventListener('global-generate', handleGlobalGenerate)
    // 每30秒刷新额度
    quotaRefreshTimer = setInterval(() => {
        fetchUserQuota()
    }, 30000)
})

onUnmounted(() => {
    cleanupTooltip()
    document.removeEventListener('click', handleDocumentClick)
    document.removeEventListener('global-generate', handleGlobalGenerate)
    if (quotaRefreshTimer) {
        clearInterval(quotaRefreshTimer)
        quotaRefreshTimer = null
    }
})
</script>

<template>
    <div class="generate-button-container">
        <div class="generate-button-wrapper">
            <button :class="buttonClass" id="generateBtn" :disabled="buttonDisabled" :style="btnStyle"
                @click="onGenerateClick">
                <template v-if="isIdleState">
                    <LightningIcon class="btn-cost-icon" :size="14" :stroke-width="2.5" />
                    {{ currentModelCost }} 运行
                </template>
                <template v-else>{{ buttonText }}</template>
            </button>
            <!-- 终止按钮：复用原下拉箭头位置，空闲时隐藏，运行中显示 -->
            <div class="batch-dropdown-trigger cancel-trigger" v-show="!isIdleState" title="终止任务"
                @click="generation.cancelCurrentTask()">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="3" fill="none">
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                </svg>
            </div>
        </div>
        <!-- 额度显示按钮 -->
        <div class="quota-btn-wrapper">
            <button class="quota-display-btn" title="点击兑换点数" @click="toggleRedeemPopup">
                <LightningIcon class="quota-icon" :size="14" :stroke-width="2.5" />
                <span>{{ quotaValue }}</span>
            </button>
            <!-- 兑换弹窗 -->
            <div class="redeem-popup" :class="{ show: isRedeemPopupVisible }">
                <div class="redeem-popup-header">
                    <span>兑换点数</span>
                    <button class="redeem-close-btn" @click="closeRedeemPopup">&times;</button>
                </div>
                <div class="redeem-popup-body">
                    <input type="text" class="redeem-input" placeholder="输入兑换码" v-model="redeemTokenValue"
                        @keyup.enter="handleRedeem">
                    <button class="redeem-submit-btn" title="兑换" @click="handleRedeem" :disabled="isRedeeming">
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="3"
                            fill="none">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
        <div class="tooltip-bubble" id="tooltipBubble">
            <div class="tooltip-content" id="tooltipContent"></div>
        </div>
    </div>
</template>
