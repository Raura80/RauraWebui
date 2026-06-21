import type { TagItem } from '../types';

// 评分配置常量 - 内部使用
const SUGGESTION_CONFIG = {
    WEIGHT_BOUNDARY: 10,
    WEIGHT_CONTINUOUS: 8,
    WEIGHT_BASE: 2,
    DENSITY_POWER: 1.2
};

// 常用标签集合 - 内部使用
const COMMON_TAGS_SET = new Set([
    'solo', '1girl', '1boy', 'full body', 'upper body', 'close up', 'cowboy shot', 'from above', 'from below',
    'from side', 'from behind', 'front view', 'back view', 'profile', 'looking at viewer',
    'looking away', 'eye contact', 'outdoors', 'indoors', 'simple background',
    'blonde hair', 'black hair', 'brown hair', 'red hair', 'blue hair', 'green hair',
    'pink hair', 'purple hair', 'silver hair', 'white hair', 'long hair', 'short hair',
    'medium hair', 'twintails', 'ponytail', 'braid', 'bob cut', 'hime cut',
    'blue eyes', 'green eyes', 'brown eyes', 'red eyes', 'purple eyes', 'heterochromia',
    'blush', 'smile', 'frown', 'pout', 'angry', 'sad', 'happy', 'surprised',
    'seductive', 'smug', 'shy', 'embarrassed', 'tears', 'wink', 'closed eyes', 'disgust',
    'standing', 'sitting', 'lying', 'kneeling', 'walking', 'running', 'jumping',
    'dancing', 'sleeping', 'eating', 'drinking', 'reading', 'writing', 'playing',
    'swimming', 'bathing', 'showering', 'stretching', 'yawning', 'crouching',
    'arms up', 'hands on hips', 'crossed arms', 'folded hands', 'pointing',
    'waving', 'thumbs up', 'peace sign', 'heart hands', 'covering face',
    'covering mouth', 'touching hair',
    'school uniform', 'maid', 'kimono', 'dress', 'skirt', 'shorts', 'pants',
    'swimsuit', 'bikini', 'lingerie', 'nude', 'see-through', 'wet', 'barefoot',
    'shoes', 'boots', 'sneakers', 'heels', 'socks', 'thighhighs', 'pantyhose',
    'gloves', 'hat', 'hair ornament', 'ribbon', 'bow', 'glasses', 'necklace',
    'earrings', 'choker',
    'breasts', 'pussy', 'penis', 'vagina', 'anus', 'butt', 'ass', 'thighs', 'cleavage',
    'underboob', 'sideboob', 'areolae', 'nipples', 'erection', 'pubic hair',
    'spread legs', 'open pussy', 'cleft of venus', 'cameltoe', 'clitoris',
    'clitoral hood', 'labia',
    'sex', 'vaginal', 'oral', 'anal', 'fellatio', 'cunnilingus', 'blowjob',
    'handjob', 'footjob', 'masturbation', 'fingering', 'penetration', 'insertion',
    'tribadism', 'scissoring', 'doggy style', 'missionary', 'cowgirl', 'reverse cowgirl',
    '69', 'group sex', 'threesome', 'orgy', 'rape', 'molestation',
    'cum', 'semen', 'cream pie', 'facial', 'body cum', 'internal cum', 'squirting',
    'female ejaculation', 'pussy juice', 'wet spot', 'sweat', 'drool', 'saliva',
    'crying', 'moan', 'screaming', 'pain', 'pleasure', 'ecstasy',
    'ahegao',
    'x-ray', 'pov', 'first person', 'deep penetration',
    'clothing lift', 'panty pull', 'bra pull', 'skirt lift', 'undressing',
    'clothed sex', 'partial nudity', 'implied nudity', 'suggestive',
    'heart', 'sparkles', 'glow', 'light rays', 'blur', 'motion lines',
    'speed lines', 'focus', 'bokeh', 'depth of field'
]);

const PARENTHESES_REGEX = /[\(（].*?[\)）]/;

// 高级评分算法 - 核心资产，内部使用
function calculateAdvancedScore(search: string, target: string, hasSpaceStructure: boolean): number {
    if (!search || !target) return 0;
    const s = search.toLowerCase();
    const t = target.toLowerCase();
    if (s === t) return 100;
    if (t.length < s.length) return 0;
    if (t.startsWith(s)) return 90 + (s.length / t.length) * 10;

    let searchIdx = 0;
    let score = 0;
    let lastTargetIdx = -2;
    let firstMatchedIdx = -1;
    let consecutiveCount = 0;
    for (let i = 0; i < t.length && searchIdx < s.length; i++) {
        if (t[i] === s[searchIdx]) {
            if (firstMatchedIdx === -1) firstMatchedIdx = i;
            let charScore = SUGGESTION_CONFIG.WEIGHT_BASE;
            const isBoundary = (i === 0) || (hasSpaceStructure && /[\s\-_]/.test(t[i - 1]));
            const isContinuous = (i === lastTargetIdx + 1);
            if (isBoundary) {
                charScore = SUGGESTION_CONFIG.WEIGHT_BOUNDARY;
            } else if (isContinuous) {
                consecutiveCount++;
                charScore = SUGGESTION_CONFIG.WEIGHT_CONTINUOUS + Math.min(consecutiveCount, 5);
            } else {
                consecutiveCount = 0;
            }
            score += charScore;
            lastTargetIdx = i;
            searchIdx++;
        }
    }
    if (searchIdx < s.length) return 0;
    // 用首次匹配位置到最后匹配位置计算实际匹配跨度
    const matchSpan = lastTargetIdx - firstMatchedIdx + 1;
    const compactness = s.length / matchSpan;
    const densityMultiplier = Math.pow(s.length / t.length, SUGGESTION_CONFIG.DENSITY_POWER);
    let finalScore = 50 + (compactness * 30) + (densityMultiplier * 10);
    if (hasSpaceStructure && /[\s\-_]/.test(t)) finalScore += 5;
    return Math.min(89, finalScore);
}

// 子序列判定
export function isSubsequence(search: string, target: string): boolean {
    if (!search || !target) return false;
    let searchIndex = 0;
    let targetIndex = 0;
    while (searchIndex < search.length && targetIndex < target.length) {
        if (search[searchIndex] === target[targetIndex]) searchIndex++;
        targetIndex++;
    }
    return searchIndex === search.length;
}

// 标签联想列表排序 - 综合排序逻辑
export function sortTagSuggestions(
    suggestions: TagItem[],
    currentWord: string,
    tagUsageFrequency: Record<string, number>,
    artistStars: Record<string, number>
): TagItem[] {
    if (!currentWord) return suggestions;
    const search = currentWord.toLowerCase().trim();
    const searchLen = search.length;
    const BONUS = {
        ARTIST_STAR: 4,
        ARTIST_USAGE: 4,
        TAG_USAGE: 6,
        COMMON_TAG: 10
    };
    const scoredList = suggestions.reduce<Array<{ item: TagItem; score: number; engTag: string; matchScore: number }>>((acc, item) => {
        const engTag = item.tag.toLowerCase();
        const cnTag = (item['right tag cn'] || '').toLowerCase();
        const pinyinTag = (item.pinyin || '').toLowerCase();
        const isArtist = item.is_artist === true || cnTag.includes('艺术家') || cnTag.includes('画师');
        let matchScore = 0;
        const scoreEn = calculateAdvancedScore(search, engTag, true);
        let scoreCn = 0;
        if (cnTag === search) scoreCn = 100;
        else if (cnTag.includes(search)) scoreCn = 80 + (searchLen / cnTag.length) * 10;
        let scorePy = isArtist ? 0 : calculateAdvancedScore(search, pinyinTag, false);
        matchScore = isArtist ? Math.max(scoreEn, scoreCn) : Math.max(scoreEn, scorePy, scoreCn);
        if (matchScore < 40) return acc;
        let qualityBonus = 0;
        const usageCount = tagUsageFrequency[engTag] || 0;
        if (isArtist) {
            const stars = artistStars[item.tag] || 0;
            const usageLog = usageCount > 0 ? Math.log10(usageCount + 1) * BONUS.ARTIST_USAGE : 0;
            const postLog = Math.log10((item.count || 1)) * 0.5;
            qualityBonus = (stars * BONUS.ARTIST_STAR) + usageLog + postLog;
        } else {
            const usageLog = usageCount > 0 ? Math.log10(usageCount + 1) * BONUS.TAG_USAGE : 0;
            qualityBonus = usageLog;
            if (COMMON_TAGS_SET.has(engTag)) qualityBonus += BONUS.COMMON_TAG;
        }
        let penalty = 0;
        if (PARENTHESES_REGEX.test(engTag)) penalty += 10;
        if (searchLen <= 2 && !engTag.startsWith(search) && !cnTag.startsWith(search)) penalty += 30;
        if (isArtist) penalty += 15;
        const totalScore = matchScore + qualityBonus - penalty;
        if (totalScore > 0) acc.push({ item, score: totalScore, engTag, matchScore });
        return acc;
    }, []);
    return scoredList.sort((a, b) => {
        const scoreDiff = b.score - a.score;
        if (Math.abs(scoreDiff) > 0.5) return scoreDiff;
        const matchDiff = b.matchScore - a.matchScore;
        if (Math.abs(matchDiff) > 0.5) return matchDiff;
        const lenDiff = a.engTag.length - b.engTag.length;
        if (lenDiff !== 0) return lenDiff;
        return a.engTag.localeCompare(b.engTag);
    }).map(entry => entry.item);
}

// 画师匹配评分
export function getArtistMatchScore(artist: { name: string; other_names?: string[] }, search: string): number {
    if (!search) return 100;
    const normalizeStr = (str: string) => str.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    const s = normalizeStr(search);
    const name = normalizeStr(artist.name);
    if (name === s) return 100;
    if (name.startsWith(s)) return 90 + (s.length / name.length) * 5;
    let maxScore = calculateAdvancedScore(s, name, true);
    if (artist.other_names && artist.other_names.length > 0) {
        for (const alias of artist.other_names) {
            const aLower = normalizeStr(alias);
            let aliasScore = 0;
            if (aLower === s) aliasScore = 85;
            else if (aLower.startsWith(s)) aliasScore = 75 + (s.length / aLower.length) * 5;
            else aliasScore = calculateAdvancedScore(s, aLower, true) * 0.8;
            maxScore = Math.max(maxScore, aliasScore);
        }
    }
    return maxScore;
}
