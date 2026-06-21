<template>
    <svg :class="className" viewBox="0 0 24 24" :width="size" :height="size" stroke="currentColor"
        :stroke-width="strokeWidth" fill="currentColor">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
    size?: number;
    strokeWidth?: number;
    className?: string;
}>(), {
    size: 14,
    strokeWidth: 2.5,
});
</script>
