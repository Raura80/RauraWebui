import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { TagItem, ArtistItem } from '../types';

export const useTagsStore = defineStore('tags', () => {
  // 标签词库数据 (ta.dat 解密后)
  const tagData = ref<TagItem[]>([]);

  // 画师数据 (ar.dat 解密后)
  const artistsData = ref<ArtistItem[]>([]);

  // 标签使用频率
  const tagUsageFrequency = ref<Record<string, number>>({});

  // 画师星级
  const artistStars = ref<Record<string, number>>({});

  // 数据是否已加载
  const isLoaded = ref(false);

  // 翻译字典 (从 tagData 构建)
  const tagDict = ref<Map<string, string>>(new Map());

  // 本地存储键
  const TAG_USAGE_STORAGE_KEY = 'tag_usage_frequency';
  const RECENT_TAGS_KEY = 'ai_image_generator_recent_used_tags';
  const ARTIST_STARS_KEY = 'ai_image_generator_artist_stars';

  // Actions
  function setTagData(data: TagItem[]) {
    tagData.value = data;
  }

  function setArtistsData(data: ArtistItem[]) {
    artistsData.value = data;
  }

  function setLoaded(value: boolean) {
    isLoaded.value = value;
  }

  // 构建翻译字典
  function buildTagDict() {
    const dict = new Map<string, string>();
    const normalizeDictKey = (tag: string) => {
      let s = tag.toLowerCase().replace(/_/g, ' ').trim();
      s = s.replace(/\s*\(\s*/g, ' (').replace(/\s*\)\s*/g, ')');
      return s.replace(/\s+/g, ' ').trim();
    };
    tagData.value.forEach(item => {
      if (item.tag && item['right tag cn']) {
        const key = normalizeDictKey(item.tag);
        let val = item['right tag cn'];
        if (item.is_artist === true || val.startsWith('艺术家:')) val = '艺术家';
        dict.set(key, val);
      }
    });
    tagDict.value = dict;
  }

  // 记录标签使用
  function recordTagUsage(tagKey: string) {
    const key = tagKey.toLowerCase();
    tagUsageFrequency.value[key] = (tagUsageFrequency.value[key] || 0) + 1;
    saveTagUsageFrequency();
    updateRecentUsage(key);
  }

  // 保存标签使用频率到 localStorage
  function saveTagUsageFrequency() {
    try {
      localStorage.setItem(TAG_USAGE_STORAGE_KEY, JSON.stringify(tagUsageFrequency.value));
    } catch (error) {
      console.error('保存标签使用记录失败:', error);
    }
  }

  // 加载标签使用频率
  function loadTagUsageFrequency() {
    try {
      const stored = localStorage.getItem(TAG_USAGE_STORAGE_KEY);
      if (stored) tagUsageFrequency.value = JSON.parse(stored);
    } catch (error) {
      console.error('加载标签使用记录失败:', error);
      tagUsageFrequency.value = {};
    }
  }

  // 更新近期使用记录
  function updateRecentUsage(tagKey: string) {
    try {
      let recentTags = JSON.parse(localStorage.getItem(RECENT_TAGS_KEY) || '[]') as string[];
      recentTags = recentTags.filter(tag => tag !== tagKey);
      recentTags.unshift(tagKey);
      if (recentTags.length > 20) recentTags = recentTags.slice(0, 20);
      localStorage.setItem(RECENT_TAGS_KEY, JSON.stringify(recentTags));
    } catch (error) {
      console.error('更新近期使用记录失败:', error);
    }
  }

  // 画师星级操作
  function loadArtistStars() {
    try {
      artistStars.value = JSON.parse(localStorage.getItem(ARTIST_STARS_KEY) || '{}');
    } catch (e) {
      artistStars.value = {};
    }
  }

  function saveArtistStars() {
    localStorage.setItem(ARTIST_STARS_KEY, JSON.stringify(artistStars.value));
  }

  function setArtistStar(name: string, stars: number) {
    artistStars.value[name] = stars;
    saveArtistStars();
  }

  return {
    tagData,
    artistsData,
    tagUsageFrequency,
    artistStars,
    isLoaded,
    tagDict,
    setTagData,
    setArtistsData,
    setLoaded,
    buildTagDict,
    recordTagUsage,
    saveTagUsageFrequency,
    loadTagUsageFrequency,
    updateRecentUsage,
    loadArtistStars,
    saveArtistStars,
    setArtistStar,
  };
});
