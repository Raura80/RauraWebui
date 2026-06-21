<script setup lang="ts">
/**
 * 关联标签弹窗组件
 * 显示与当前选中标签相关联的标签列表
 * 原版逻辑：composable 通过 DOM 直接操作 #relatedTagsPopup / #relatedTagsBody / #relatedTagsTarget
 * 这里只提供 DOM 结构，数据渲染由 useTagSearchPopup 的 renderRelatedTags 处理
 */
</script>

<template>
    <!-- 原版 HTML 结构：composable 通过 DOM id 直接操作此弹窗 -->
    <div class="artist-search-popup related-tags-popup" id="relatedTagsPopup"
        style="width: 280px; z-index: 1003; display: none;">
        <div class="artist-search-header" style="padding: 10px 15px;">
            <span style="font-size: 14px; font-weight: bold; color: var(--primary-color);">关联标签：</span>
            <span id="relatedTagsTarget"
                style="font-size: 12px; color: var(--text-muted); margin-left: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-block; max-width: 150px; vertical-align: bottom;"></span>
        </div>
        <div class="artist-list-header">
            <div class="artist-col" style="flex: 1; cursor: default;">标签</div>
            <div class="artist-col num-col" style="flex: 0 0 60px; justify-content: center; cursor: default;">关联度</div>
        </div>
        <div class="artist-list-body" id="relatedTagsBody" style="max-height: 570px;"></div>
    </div>
</template>
